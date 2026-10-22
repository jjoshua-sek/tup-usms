"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { parseAttendanceCsv, termSequence } from "@/lib/risk/attendance-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";

export interface ImportResult {
  error?: string;
  imported?: number;
  /** Rows for student numbers STARS does not have. */
  notFound?: string[];
  problems?: Array<{ line: number; message: string }>;
}

const formSchema = z.object({
  school_year: z.string().trim().regex(/^\d{4}-\d{4}$/, { message: "School year must look like 2026-2027." }),
  semester: z.enum(["1st Semester", "2nd Semester", "Summer"]),
  source: z.string().trim().min(2, { message: "Say who sent the file, e.g. COS Dean's Office." }).max(120),
});

/** A sheet is well under this; the cap keeps a wrong file from tying up the server. */
const MAX_FILE_BYTES = 900 * 1024;

/**
 * Imports a term's attendance from a college's or the Registrar's sheet
 * (checklist E2). Each row replaces that student's record for the term, and
 * the early-warning score uses it from the next page load.
 */
export async function importAttendance(formData: FormData): Promise<ImportResult> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can import attendance." };

  const parsedForm = formSchema.safeParse({
    school_year: formData.get("school_year"),
    semester: formData.get("semester"),
    source: formData.get("source"),
  });
  if (!parsedForm.success) return { error: parsedForm.error.issues[0]?.message ?? "Check the term and the source." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file." };
  if (file.size > MAX_FILE_BYTES) return { error: "That file is too large for an attendance sheet. Save it as CSV and try again." };

  const parsed = parseAttendanceCsv(await file.text());
  if (parsed.error) return { error: parsed.error, problems: parsed.problems };
  if (parsed.rows.length === 0) return { error: "No usable rows in the file.", problems: parsed.problems };

  const db = loose(createAdminClient());
  const numbers = parsed.rows.map((row) => row.student_number);
  const ids = new Map<string, string>();
  for (let start = 0; start < numbers.length; start += 500) {
    const { data } = await db.from("students").select("id, student_number").in("student_number", numbers.slice(start, start + 500));
    for (const row of (data as Array<{ id: string; student_number: string }> | null) ?? []) ids.set(row.student_number, row.id);
  }

  const { school_year, semester } = parsedForm.data;
  const source = sanitizeText(parsedForm.data.source, 120);
  const batchId = randomUUID();
  const records = parsed.rows
    .filter((row) => ids.has(row.student_number))
    .map((row) => ({
      student_id: ids.get(row.student_number)!,
      school_year,
      semester,
      term_sequence: termSequence(school_year, semester),
      sessions_held: row.sessions_held,
      sessions_absent: row.sessions_absent,
      attendance_rate: row.attendance_rate,
      source,
      batch_id: batchId,
      imported_by: staff.staffId,
      imported_at: new Date().toISOString(),
    }));
  const notFound = parsed.rows.filter((row) => !ids.has(row.student_number)).map((row) => row.student_number);

  if (records.length > 0) {
    const { error } = await db.from("attendance_records").upsert(records, { onConflict: "student_id,school_year,semester" });
    if (error) {
      return {
        error: ["PGRST205", "42P01"].includes((error as { code?: string }).code ?? "")
          ? "Importing attendance needs migration 00043. Ask the administrator to run it."
          : "The attendance could not be saved. Nothing was imported.",
      };
    }
  }

  await logAuditEvent(staff.userId, "attendance_imported", "attendance_records", {
    batch_id: batchId,
    term: `${semester} ${school_year}`,
    source,
    imported: records.length,
    not_found: notFound.length,
    problems: parsed.problems.length,
  });

  revalidatePath("/staff/risk");
  revalidatePath("/staff/risk/attendance");
  return { imported: records.length, notFound, problems: parsed.problems };
}
