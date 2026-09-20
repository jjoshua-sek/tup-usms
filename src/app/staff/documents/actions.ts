"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAcademicExtraction } from "@/lib/ai/run-extraction";
import { getStaffContext } from "@/lib/osa/staff-context";
import { classScheduleToBlocks } from "@/lib/scheduling/find-slots";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";
import type { ExtractedAcademicData } from "@/types/osa";

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

  const db = loose(createAdminClient());

  const { data: documentRow } = await db
    .from("academic_documents")
    .select(
      "id, student_id, school_year, semester, document_type, extracted_data, students(user_id)",
    )
    .eq("id", parsed.data.document_id)
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

  const corrected = {
    gwa: parsed.data.gwa,
    units_enrolled: parsed.data.units_enrolled,
    units_passed: parsed.data.units_passed,
    units_failed: parsed.data.units_failed,
    scholastic_status: parsed.data.scholastic_status || undefined,
  };

  await db
    .from("academic_documents")
    .update({
      processing_status: "verified",
      verified_by: staff.staffId,
      verified_at: new Date().toISOString(),
      corrected_data: corrected,
      verification_notes: parsed.data.notes ? sanitizeText(parsed.data.notes, 1000) : null,
    })
    .eq("id", document.id);

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
    data_source: "manual_entry",
  };
  if (parsed.data.gwa != null) snapshot.gwa = parsed.data.gwa;
  if (parsed.data.units_enrolled != null) snapshot.units_enrolled = parsed.data.units_enrolled;
  if (parsed.data.units_passed != null) snapshot.units_passed = parsed.data.units_passed;
  if (parsed.data.units_failed != null) snapshot.units_failed = parsed.data.units_failed;
  if (parsed.data.scholastic_status) snapshot.scholastic_status = parsed.data.scholastic_status;

  const { error } = existingRow
    ? await db
        .from("academic_snapshots")
        .update(snapshot)
        .eq("id", (existingRow as { id: string }).id)
    : await db.from("academic_snapshots").insert(snapshot);

  if (error) return { error: "Verified the document, but the term snapshot failed to save." };

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
    imported_schedule_blocks: importedBlocks,
  });

  revalidatePath("/staff/documents");
  revalidatePath("/staff/risk");
  return {
    ok: true,
    message: importedBlocks
      ? `Verified — snapshot updated and ${importedBlocks} class times imported.`
      : "Verified — the term snapshot is updated.",
  };
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
      p_type: "academic_document",
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
