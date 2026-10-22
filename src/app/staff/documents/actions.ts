"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAcademicExtraction } from "@/lib/ai/run-extraction";
import { unitsFromGrades } from "@/lib/documents/integrity";
import { normalizeCollege } from "@/lib/osa/college-report";
import { readStampedScan } from "@/lib/documents/scan-stamped";
import { compareWithScan, type ScanComparison } from "@/lib/documents/stamped-scan";
import { getStaffContext } from "@/lib/osa/staff-context";
import { classScheduleToBlocks } from "@/lib/scheduling/find-slots";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { sanitizeText } from "@/lib/utils/sanitize";
import type { AcademicDocument, ExtractedAcademicData } from "@/types/osa";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Monotonic ordering key for a term, so "the previous term" is a numeric
 * comparison rather than string parsing. 1st Sem 2026-2027 → 20261.
 */
function termSequence(schoolYear: string, semester: string): number {
  const startYear = Number(schoolYear.split("-")[0]);
  const offset = semester === "1st Semester" ? 1 : semester === "2nd Semester" ? 2 : 3;
  return startYear * 10 + offset;
}

const verifySchema = z.object({
  document_id: z.string().uuid(),
  gwa: z.coerce.number().min(1).max(5).optional(),
  units_enrolled: z.coerce.number().int().min(0).max(60).optional(),
  units_passed: z.coerce.number().int().min(0).max(60).optional(),
  units_failed: z.coerce.number().int().min(0).max(60).optional(),
  scholastic_status: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

/**
 * Verifies an uploaded rating slip / COR and promotes its figures into an
 * `academic_snapshots` row.
 *
 * This is the human gate on the ML pipeline. Extraction (by model or by eye)
 * proposes; a staff member confirms. Nothing a student uploads reaches the
 * risk score without someone putting their name against the numbers — which
 * is also why the snapshot records `data_source` and the source document id.
 */
export async function verifyAcademicDocument(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can verify academic documents." };

  const raw = {
    document_id: formData.get("document_id"),
    gwa: emptyToUndefined(formData.get("gwa")),
    units_enrolled: emptyToUndefined(formData.get("units_enrolled")),
    units_passed: emptyToUndefined(formData.get("units_passed")),
    units_failed: emptyToUndefined(formData.get("units_failed")),
    scholastic_status: formData.get("scholastic_status") ?? "",
    notes: formData.get("notes") ?? "",
  };

  const parsed = verifySchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the figures you entered." };
  }

  return verifyDocument({
    staff,
    documentId: parsed.data.document_id,
    figures: {
      gwa: parsed.data.gwa,
      units_enrolled: parsed.data.units_enrolled,
      units_passed: parsed.data.units_passed,
      units_failed: parsed.data.units_failed,
      scholastic_status: parsed.data.scholastic_status || undefined,
    },
    method: "on_screen",
    notes: parsed.data.notes ? sanitizeText(parsed.data.notes, 1000) : null,
  });
}

interface VerifiedFigures {
  gwa?: number;
  units_enrolled?: number;
  units_passed?: number;
  units_failed?: number;
  scholastic_status?: string;
}

/**
 * Marks a document verified and writes its term snapshot: the one path both
 * kinds of verification take, so they cannot drift apart.
 */
async function verifyDocument(input: {
  staff: NonNullable<Awaited<ReturnType<typeof getStaffContext>>>;
  documentId: string;
  figures: VerifiedFigures;
  method: "on_screen" | "counter_scan";
  notes: string | null;
}): Promise<Result> {
  const { staff } = input;
  const db = loose(createAdminClient());

  const { data: documentRow } = await db
    .from("academic_documents")
    .select(
      "id, student_id, school_year, semester, document_type, extracted_data, students(user_id)",
    )
    .eq("id", input.documentId)
    .maybeSingle();

  const document = documentRow as {
    id: string;
    student_id: string;
    school_year: string;
    semester: string;
    document_type: string;
    extracted_data: ExtractedAcademicData | null;
    students: { user_id: string } | null;
  } | null;
  if (!document) return { error: "Document not found." };

  const corrected = input.figures;

  const { error: verifyError } = await updateDocument(
    db,
    document.id,
    {
      processing_status: "verified",
      verified_by: staff.staffId,
      verified_at: new Date().toISOString(),
      corrected_data: corrected,
      verification_notes: input.notes,
    },
    { verification_method: input.method },
  );
  if (verifyError) return { error: "Could not mark the document verified." };

  // One snapshot per student per term: a COR (units) and a rating slip
  // (grades) for the same term fill in different columns of the same row.
  const { data: existingRow } = await db
    .from("academic_snapshots")
    .select("id")
    .eq("student_id", document.student_id)
    .eq("school_year", document.school_year)
    .eq("semester", document.semester)
    .maybeSingle();

  const snapshot: Record<string, unknown> = {
    student_id: document.student_id,
    school_year: document.school_year,
    semester: document.semester,
    term_sequence: termSequence(document.school_year, document.semester),
    source_document_id: document.id,
    // Typed or confirmed by an officer on screen, or read from the upload
    // and matched against the stamped paper.
    data_source: input.method === "counter_scan" ? "document_extraction" : "manual_entry",
  };
  if (corrected.gwa != null) snapshot.gwa = corrected.gwa;
  if (corrected.units_enrolled != null) snapshot.units_enrolled = corrected.units_enrolled;
  if (corrected.units_passed != null) snapshot.units_passed = corrected.units_passed;
  if (corrected.units_failed != null) snapshot.units_failed = corrected.units_failed;
  if (corrected.scholastic_status) snapshot.scholastic_status = corrected.scholastic_status;

  const { error } = existingRow
    ? await db
        .from("academic_snapshots")
        .update(snapshot)
        .eq("id", (existingRow as { id: string }).id)
    : await db.from("academic_snapshots").insert(snapshot);

  if (error) return { error: "Verified the document, but the term snapshot failed to save." };

  // A verified COR also says which college the student is in (I5, reports
  // per college). Before migration 00042 there is no column; nothing breaks.
  const college = normalizeCollege(document.extracted_data?.college);
  if (document.document_type === "certificate_of_registration" && college) {
    const { error: collegeError } = await db.from("students").update({ college }).eq("id", document.student_id);
    if (collegeError) console.error("[documents] college not saved", collegeError.message);
  }

  // A verified COR carries the student's class times. Turning them into busy
  // blocks here is what lets the hearing scheduler avoid booking a meeting
  // on top of a lecture — the student never has to type their timetable in.
  let importedBlocks = 0;
  if (
    document.document_type === "certificate_of_registration" &&
    document.students?.user_id
  ) {
    importedBlocks = await importCorSchedule(db, {
      userId: document.students.user_id,
      extracted: document.extracted_data,
      schoolYear: document.school_year,
      semester: document.semester,
    });
  }

  await logAuditEvent(staff.userId, "academic_doc_reviewed", "academic_documents", {
    document_id: document.id,
    decision: "verified",
    method: input.method,
    imported_schedule_blocks: importedBlocks,
  });

  revalidatePath("/staff/documents");
  revalidatePath("/staff/risk");
  revalidatePath("/staff/id-validation");
  const how = input.method === "counter_scan" ? "Verified with the stamped copy" : "Verified";
  return {
    ok: true,
    message: importedBlocks
      ? `${how}: snapshot updated and ${importedBlocks} class times imported.`
      : `${how}: the term snapshot is updated.`,
  };
}

/**
 * An update that also writes columns a newer migration added, and still
 * saves the rest if that migration has not run yet.
 */
async function updateDocument(
  db: ReturnType<typeof loose>,
  id: string,
  values: Record<string, unknown>,
  newColumns: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  const first = await db.from("academic_documents").update({ ...values, ...newColumns }).eq("id", id);
  if (!first.error || !["PGRST204", "42703"].includes((first.error as { code?: string }).code ?? "")) {
    return { error: first.error };
  }
  return db.from("academic_documents").update(values).eq("id", id);
}

/** A counter photo goes through a Server Action, whose body is capped at 1 MB. */
const MAX_SCAN_BYTES = 950 * 1024;
const SCAN_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ScanResult extends Result {
  comparison?: ScanComparison;
}

/**
 * Reads a photo of the Registrar-stamped COR or rating slip, taken at the
 * counter, and compares it row by row with what the student uploaded. Saves
 * the photo as evidence and the comparison on the document; verifying is a
 * separate click (verifyWithStampedScan), so the officer sees the result
 * first.
 */
export async function scanStampedCopy(formData: FormData): Promise<ScanResult> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can verify documents." };

  const documentId = z.string().uuid().safeParse(formData.get("document_id"));
  const photo = formData.get("photo");
  if (!documentId.success) return { error: "Choose a document first." };
  if (!(photo instanceof File) || photo.size === 0) return { error: "Take a photo of the stamped copy first." };
  if (!SCAN_TYPES.has(photo.type)) return { error: "The photo must be a JPG, PNG or WebP image." };
  if (photo.size > MAX_SCAN_BYTES) return { error: "The photo is too large. Retake it; it is shrunk automatically." };

  const limit = checkRateLimit({ identifier: `stamped-scan:${staff.staffId}`, maxRequests: 30, windowSeconds: 600 });
  if (!limit.success) return { error: "Too many scans in a few minutes. Wait a moment, then try again." };

  const admin = createAdminClient();
  const db = loose(admin);
  const { data: documentRow } = await db
    .from("academic_documents")
    .select("*")
    .eq("id", documentId.data)
    .maybeSingle();
  const document = documentRow as (AcademicDocument & { stamped_scan_path?: string | null }) | null;
  if (!document) return { error: "Document not found." };
  if (document.processing_status === "verified") return { error: "This document is already verified." };
  if (!document.extracted_data) {
    return { error: "STARS has not read the upload yet, so there is nothing to compare. Use Re-read with AI first." };
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const read = await readStampedScan({
    bytes,
    mediaType: photo.type,
    documentLabel: document.document_type === "rating_slip" ? "rating slip" : "Certificate of Registration",
  });
  if (!read.ok) return { error: `The photo could not be read: ${read.error} Try again, or verify on screen.` };

  // The figures the officer would otherwise confirm: what was read from the
  // upload, with any correction an officer already typed on top.
  const uploaded: ExtractedAcademicData = {
    ...document.extracted_data,
    ...(document.corrected_data ?? {}),
    subjects: document.extracted_data.subjects,
    school_year: document.extracted_data.school_year ?? document.school_year,
    semester: document.extracted_data.semester ?? document.semester,
  };
  const comparison = compareWithScan({ documentType: document.document_type, uploaded, scan: read.scan });

  const path = `stamped/${document.student_id}/${document.id}-${Date.now()}.${photo.type.split("/")[1] === "jpeg" ? "jpg" : photo.type.split("/")[1]}`;
  const { error: uploadError } = await admin.storage
    .from("academic-documents")
    .upload(path, bytes, { contentType: photo.type, upsert: false });
  if (uploadError) {
    console.error("[stamped-scan] photo not saved", uploadError);
    return { error: "The photo could not be saved as evidence. Try again." };
  }

  const { error: saveError } = await db
    .from("academic_documents")
    .update({
      stamped_scan_path: path,
      scan_comparison: { ...comparison, model: read.model, read_at: new Date().toISOString(), scan: read.scan },
      scanned_by: staff.staffId,
      scanned_at: new Date().toISOString(),
    })
    .eq("id", document.id);
  if (saveError) {
    await admin.storage.from("academic-documents").remove([path]);
    return {
      error: ["PGRST204", "42703"].includes((saveError as { code?: string }).code ?? "")
        ? "Scanning needs migration 00037. Ask the administrator to run it."
        : "The comparison could not be saved. Try again.",
    };
  }
  // One scan per document is kept: the latest.
  if (document.stamped_scan_path) await admin.storage.from("academic-documents").remove([document.stamped_scan_path]);

  await logAuditEvent(staff.userId, "academic_doc_reviewed", "academic_documents", {
    document_id: document.id,
    decision: "stamped_copy_scanned",
    verdict: comparison.verdict,
    registrar_stamp: comparison.stamps.registrar,
    differences: comparison.differences.length,
  });

  revalidatePath("/staff/documents");
  revalidatePath("/staff/id-validation");
  return { ok: true, comparison };
}

/** Verifies a document whose stamped copy matched, with the figures the upload carries. */
export async function verifyWithStampedScan(documentId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can verify documents." };
  if (!z.string().uuid().safeParse(documentId).success) return { error: "Choose a document first." };

  const db = loose(createAdminClient());
  const { data: documentRow } = await db.from("academic_documents").select("*").eq("id", documentId).maybeSingle();
  const document = documentRow as (AcademicDocument & { scan_comparison?: ScanComparison | null }) | null;
  if (!document) return { error: "Document not found." };
  if (document.processing_status === "verified") return { error: "This document is already verified." };
  if (!document.scan_comparison?.canVerify) {
    return { error: "The stamped copy has not matched yet. Scan it again, or verify on screen." };
  }

  const figures = { ...(document.extracted_data ?? {}), ...(document.corrected_data ?? {}) };
  const fromGrades = unitsFromGrades(document.extracted_data?.subjects);
  return verifyDocument({
    staff,
    documentId: document.id,
    figures: {
      gwa: figures.gwa,
      units_enrolled: figures.units_enrolled,
      units_passed: figures.units_passed ?? (document.document_type === "rating_slip" ? fromGrades.passed : undefined),
      units_failed: figures.units_failed ?? (document.document_type === "rating_slip" ? fromGrades.failed : undefined),
      scholastic_status: figures.scholastic_status,
    },
    method: "counter_scan",
    notes: "Matched against the Registrar-stamped copy scanned at the OSA counter.",
  });
}

/** Opens the stamped-copy photo kept as evidence, for five minutes. */
export async function getStampedScanUrl(documentId: string): Promise<{ url?: string; error?: string }> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Not permitted." };
  const admin = createAdminClient();
  const { data } = await loose(admin).from("academic_documents").select("stamped_scan_path").eq("id", documentId).maybeSingle();
  const path = (data as { stamped_scan_path?: string | null } | null)?.stamped_scan_path;
  if (!path) return { error: "No stamped copy has been scanned for this document." };
  const { data: signed } = await admin.storage.from("academic-documents").createSignedUrl(path, 300);
  return signed?.signedUrl ? { url: signed.signedUrl } : { error: "Could not open the scan." };
}

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** "9:00" / "09:00" / "09:00:00" → "09:00:00"; anything else → null. */
function toTimeString(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  if (hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}:00`;
}

function normalizeDay(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().toLowerCase();
  return DAY_NAMES.find((day) => day.toLowerCase() === candidate) ?? null;
}

/**
 * Replaces this term's COR-imported blocks with the verified schedule.
 *
 * Replace rather than append: a student who re-uploads after adding or
 * dropping a subject would otherwise accumulate phantom classes, and the
 * scheduler would quietly stop finding any free slot. Manually entered blocks
 * are left alone — those are the student's own.
 */
async function importCorSchedule(
  db: ReturnType<typeof loose>,
  input: {
    userId: string;
    extracted: ExtractedAcademicData | null;
    schoolYear: string;
    semester: string;
  },
): Promise<number> {
  const entries = (input.extracted?.subjects ?? []).flatMap((subject) =>
    (subject.schedule ?? []).flatMap((slot) => {
      const day = normalizeDay(slot.day_of_week);
      const start = toTimeString(slot.start_time);
      const end = toTimeString(slot.end_time);
      // Skip anything that didn't come back clean — a half-read row is worse
      // than a missing one, because it silently blocks real free time.
      if (!day || !start || !end || end <= start) return [];
      return [
        {
          day_of_week: day,
          start_time: start,
          end_time: end,
          subject_code: subject.subject_code,
        },
      ];
    }),
  );

  if (entries.length === 0) return 0;

  await db
    .from("availability_blocks")
    .delete()
    .eq("user_id", input.userId)
    .eq("source", "cor_import")
    .eq("school_year", input.schoolYear)
    .eq("semester", input.semester);

  const blocks = classScheduleToBlocks(input.userId, entries, {
    school_year: input.schoolYear,
    semester: input.semester,
  }).map((block) => ({
    ...block,
    school_year: input.schoolYear,
    semester: input.semester,
  }));

  const { error } = await db.from("availability_blocks").insert(blocks);
  return error ? 0 : blocks.length;
}

/**
 * Re-reads a document with the model.
 *
 * Staff-triggered because staff are the ones who can see that the extraction
 * came back thin — a rotated photo, a page half out of frame — and who bear
 * the cost of typing it out otherwise.
 */
export async function rerunExtraction(documentId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can re-run extraction." };

  const outcome = await runAcademicExtraction(documentId);
  if (outcome.error) return { error: outcome.error };

  revalidatePath("/staff/documents");
  return {
    ok: true,
    message:
      outcome.confidence != null
        ? `Read with ${Math.round(outcome.confidence * 100)}% confidence.`
        : "Read.",
  };
}

const rejectSchema = z.object({
  document_id: z.string().uuid(),
  reason: z.string().trim().min(5, { message: "Tell the student what to fix." }).max(500),
});

export async function rejectAcademicDocument(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can reject documents." };

  const parsed = rejectSchema.safeParse({
    document_id: formData.get("document_id"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Give a reason." };
  }

  const db = loose(createAdminClient());

  const { data: documentRow } = await db
    .from("academic_documents")
    .select("id, students(user_id)")
    .eq("id", parsed.data.document_id)
    .maybeSingle();

  const document = documentRow as {
    id: string;
    students: { user_id: string } | null;
  } | null;
  if (!document) return { error: "Document not found." };

  const { error } = await db
    .from("academic_documents")
    .update({
      processing_status: "rejected",
      rejection_reason: sanitizeText(parsed.data.reason, 500),
      verified_by: staff.staffId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", document.id);

  if (error) return { error: "Could not reject the document." };

  if (document.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: document.students.user_id,
      p_type: "document_rejected",
      p_title: "Your uploaded document needs attention",
      p_body: `The OSA could not accept it: ${parsed.data.reason}`,
      p_priority: "normal",
      p_channels: ["in_app"],
      p_action_url: "/records",
      p_action_label: "Upload a replacement",
      p_entity_type: "academic_document",
      p_entity_id: document.id,
    });
  }

  await logAuditEvent(staff.userId, "academic_doc_reviewed", "academic_documents", {
    document_id: document.id,
    decision: "rejected",
  });

  revalidatePath("/staff/documents");
  return { ok: true, message: "Rejected. The student has been told why." };
}

/** Issues a short-lived signed URL so staff can actually read the upload. */
export async function getDocumentViewUrl(documentId: string): Promise<{
  url?: string;
  error?: string;
}> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Not permitted." };

  const db = loose(createAdminClient());
  const { data: documentRow } = await db
    .from("academic_documents")
    .select("file_path")
    .eq("id", documentId)
    .maybeSingle();

  const document = documentRow as { file_path: string } | null;
  if (!document) return { error: "Document not found." };

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("academic-documents")
    // Five minutes: long enough to read, short enough that a copied link
    // isn't a standing grant to someone's grades.
    .createSignedUrl(document.file_path, 300);

  if (error || !data?.signedUrl) return { error: "Could not open that file." };
  return { url: data.signedUrl };
}

function emptyToUndefined(value: FormDataEntryValue | null): FormDataEntryValue | undefined {
  if (value == null) return undefined;
  return String(value).trim() === "" ? undefined : value;
}
