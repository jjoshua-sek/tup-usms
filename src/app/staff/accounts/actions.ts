"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  MAX_ROWS,
  STUDENT_NUMBER,
  parseEnrollmentList,
  revalidateRecord,
  type EnrollmentRecord,
} from "@/lib/accounts/enrollment";
import { provisionStaff, provisionStudent } from "@/lib/accounts/provision";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";
import { newPasswordSchema } from "@/lib/validations/auth";
import { STAFF_ROLES } from "@/types/osa";

// Every export of this file is a public endpoint — each one checks for an
// administrator itself rather than trusting that only the Accounts page
// calls it.

async function requireAdmin() {
  const staff = await getStaffContext();
  return staff?.isAdmin ? staff : null;
}

const NOT_ADMIN = "Only an administrator can create accounts.";
const MAX_FILE_BYTES = 1_000_000;
const CHUNK_SIZE = 25;

// ============================================================
// BULK: PREVIEW
// ============================================================

export interface PreviewRow {
  line: number;
  record: EnrollmentRecord | null;
  errors: string[];
  /** A student with this number already has an account or a pending invitation. */
  exists: boolean;
}

export interface PreviewResult {
  error?: string;
  fileErrors?: string[];
  rows?: PreviewRow[];
}

/**
 * Reads the uploaded list and says, row by row, what importing it would do.
 * Writes nothing: the admin sees every problem before any account exists.
 */
export async function previewEnrollment(formData: FormData): Promise<PreviewResult> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };

  const file = formData.get("file");
  const pasted = formData.get("csv");
  let text = "";

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "That file is larger than 1 MB." };
    text = await file.text();
  } else if (typeof pasted === "string") {
    if (pasted.length > MAX_FILE_BYTES) return { error: "That list is larger than 1 MB." };
    text = pasted;
  }

  if (!text.trim()) return { error: "Choose a CSV file or paste the list first." };

  const parsed = parseEnrollmentList(text);
  if (parsed.fileErrors.length > 0) return { fileErrors: parsed.fileErrors };

  // Which of these students already have an account, so the preview can
  // say so now instead of every one failing at import. Checked in slices:
  // a thousand values in one `in` filter makes a URL too long to send.
  const numbers = parsed.rows.flatMap((row) => (row.record ? [row.record.student_number] : []));
  const existing = new Set<string>();
  const db = loose(await createClient());

  for (let start = 0; start < numbers.length; start += 150) {
    const slice = numbers.slice(start, start + 150);
    const [invited, students] = await Promise.all([
      db.from("account_invitations").select("student_number").in("student_number", slice),
      db.from("students").select("student_number").in("student_number", slice),
    ]);
    for (const row of [...((invited.data as Array<{ student_number: string }> | null) ?? []), ...((students.data as Array<{ student_number: string }> | null) ?? [])]) {
      existing.add(row.student_number);
    }
  }

  return {
    rows: parsed.rows.map((row) => ({
      ...row,
      exists: row.record ? existing.has(row.record.student_number) : false,
    })),
  };
}

// ============================================================
// BULK: IMPORT
// ============================================================

export interface ImportRowResult {
  student_number: string;
  status: "created" | "exists" | "error";
  message?: string;
}

/**
 * Creates accounts for one slice of a previewed list. The page sends the
 * list in slices so a large import shows progress and no single request
 * runs long enough to time out.
 *
 * Each record is validated again here: the browser held the previewed rows
 * between preview and import, and nothing it sends back is trusted.
 */
export async function importEnrollmentChunk(input: {
  batchId: string;
  records: unknown[];
}): Promise<{ error?: string; results?: ImportRowResult[] }> {
  const staff = await requireAdmin();
  if (!staff) return { error: NOT_ADMIN };

  if (!z.string().uuid().safeParse(input.batchId).success) return { error: "Invalid import." };
  if (!Array.isArray(input.records) || input.records.length > CHUNK_SIZE) {
    return { error: `Send at most ${CHUNK_SIZE} students at a time.` };
  }

  const results: ImportRowResult[] = [];
  for (const raw of input.records) {
    const record = revalidateRecord((raw ?? {}) as Record<string, unknown>);
    if (!record) {
      results.push({ student_number: "?", status: "error", message: "This row did not pass validation." });
      continue;
    }

    const outcome = await provisionStudent(record, { createdBy: staff.staffId, batchId: input.batchId });
    results.push({
      student_number: record.student_number,
      status: outcome.status,
      message: outcome.status === "created" ? undefined : outcome.message,
    });
  }

  await logAuditEvent(staff.userId, "enrollment_imported", "account_invitations", {
    batch_id: input.batchId,
    created: results.filter((result) => result.status === "created").length,
    skipped: results.filter((result) => result.status === "exists").length,
    failed: results.filter((result) => result.status === "error").length,
  });

  revalidatePath("/staff/accounts");
  return { results };
}

/** A fresh id for one import, so its invitations can be found together. */
export async function startEnrollmentImport(): Promise<{ error?: string; batchId?: string; maxRows?: number }> {
  if (!(await requireAdmin())) return { error: NOT_ADMIN };
  return { batchId: randomUUID(), maxRows: MAX_ROWS };
}

// ============================================================
// ONE ACCOUNT
// ============================================================

const staffSchema = z.object({
  login_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(STUDENT_NUMBER, "Login ID must look like TUPM-XX-XXXX."),
  full_name: z.string().trim().min(2, "Enter the staff member's full name.").max(120),
  department: z.string().trim().min(2, "Enter a department.").max(120),
  position: z.string().trim().min(2, "Enter a position.").max(120),
  office: z.string().trim().max(120).optional(),
  role_type: z.enum(STAFF_ROLES),
  can_access_confidential: z.boolean(),
  password: newPasswordSchema,
});

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Creates one account — the path for a student missing from the list, a
 * late enrollee, or a new staff member — without going near the database.
 */
export async function createAccount(formData: FormData): Promise<Result> {
  const staff = await requireAdmin();
  if (!staff) return { error: NOT_ADMIN };

  const kind = formData.get("kind");

  if (kind === "student") {
    const record = revalidateRecord({
      student_number: formData.get("student_number"),
      first_name: formData.get("first_name"),
      last_name: formData.get("last_name"),
      email: formData.get("email"),
      program: formData.get("program"),
      year_level: formData.get("year_level"),
      section: formData.get("section"),
    } as Record<string, unknown>);
    if (!record) return { error: "Check the student's details — one of them is missing or not in the expected format." };

    const setPassword = formData.get("delivery") === "password";
    let password: string | null = null;
    if (setPassword) {
      const parsed = newPasswordSchema.safeParse(formData.get("password"));
      if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
      password = parsed.data;
    }

    const outcome = await provisionStudent(record, { createdBy: staff.staffId, password });
    if (outcome.status !== "created") return { error: outcome.message };

    await logAuditEvent(staff.userId, "account_created", "auth.users", {
      kind: "student",
      login_id: record.student_number,
      delivery: setPassword ? "password" : "link",
    });
    revalidatePath("/staff/accounts");

    return {
      ok: true,
      message: setPassword
        ? `${record.student_number} can sign in now with the password you set.`
        : `${record.student_number} was created. The sign-in link goes to ${record.email} within a minute.`,
    };
  }

  if (kind === "staff") {
    const parsed = staffSchema.safeParse({
      login_id: formData.get("login_id"),
      full_name: formData.get("full_name"),
      department: formData.get("department"),
      position: formData.get("position"),
      office: formData.get("office") || undefined,
      role_type: formData.get("role_type"),
      can_access_confidential: formData.get("can_access_confidential") === "on",
      password: formData.get("password"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };

    const outcome = await provisionStaff({
      loginId: parsed.data.login_id,
      fullName: sanitizeText(parsed.data.full_name, 120),
      department: sanitizeText(parsed.data.department, 120),
      position: sanitizeText(parsed.data.position, 120),
      office: parsed.data.office ? sanitizeText(parsed.data.office, 120) : null,
      roleType: parsed.data.role_type,
      canAccessConfidential: parsed.data.can_access_confidential,
      password: parsed.data.password,
    });
    if (outcome.status !== "created") return { error: outcome.message };

    await logAuditEvent(staff.userId, "account_created", "auth.users", {
      kind: "staff",
      login_id: parsed.data.login_id,
      role_type: parsed.data.role_type,
      can_access_confidential: parsed.data.can_access_confidential,
    });
    revalidatePath("/staff/accounts");

    return { ok: true, message: `${parsed.data.login_id} can sign in now with the password you set.` };
  }

  return { error: "Choose whether this is a student or a staff account." };
}

// ============================================================
// RESEND
// ============================================================

/**
 * Queues a fresh link. The dispatcher mints a new token when it sends, and a
 * new token replaces the old one, so whatever was sent before stops working.
 */
export async function resendInvitation(invitationId: string): Promise<Result> {
  const staff = await requireAdmin();
  if (!staff) return { error: NOT_ADMIN };
  if (!z.string().uuid().safeParse(invitationId).success) return { error: "Invitation not found." };

  const { data, error } = await loose(await createClient())
    .from("account_invitations")
    .update({ status: "queued", attempts: 0, next_attempt_at: null, last_error: null })
    .eq("id", invitationId)
    .in("status", ["queued", "sent", "failed", "undeliverable"])
    .select("student_number, delivery_email");

  const updated = (data as Array<{ student_number: string; delivery_email: string }> | null) ?? [];
  if (error || updated.length === 0) {
    return { error: "That account is already set up, or the invitation no longer exists." };
  }

  await logAuditEvent(staff.userId, "invitation_resent", "account_invitations", {
    invitation_id: invitationId,
    student_number: updated[0].student_number,
  });
  revalidatePath("/staff/accounts");

  return { ok: true, message: `A new link goes to ${updated[0].delivery_email} within a minute.` };
}
