import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import type { StaffRole } from "@/types/osa";

import { loginEmailFor, type EnrollmentRecord } from "./enrollment";

/**
 * Creating accounts through the Supabase auth admin API.
 *
 * Every account here takes two writes: an auth user, then a row in our own
 * schema (an invitation for students, a staff record for staff). They cannot
 * share a transaction, since one lives behind the Auth API. So a failed
 * second write deletes the first. Without that, a retry would hit
 * "already registered" for a login nobody can use, and the only fix would
 * be the Supabase dashboard — the thing this screen exists to replace.
 *
 * Login addresses follow the login form: <STUDENT-NUMBER>@tup.edu.ph, for
 * staff as well as students (staff use placeholder numbers).
 */

export type ProvisionOutcome =
  | { status: "created"; userId: string }
  | { status: "exists"; message: string }
  | { status: "error"; message: string };

function alreadyRegistered(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "email_exists" ||
    candidate?.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(candidate?.message ?? "")
  );
}

/**
 * One student account.
 *
 * With no password, the account is created unusable-until-activated: it has
 * no password, so it cannot sign in until the student follows the one-time
 * link the dispatcher emails them. With a password (the in-person fallback),
 * it works immediately and no link is sent.
 */
export async function provisionStudent(
  record: EnrollmentRecord,
  options: { createdBy: string; batchId?: string | null; password?: string | null },
): Promise<ProvisionOutcome> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: loginEmailFor(record.student_number),
    email_confirm: true,
    ...(options.password ? { password: options.password } : {}),
    // Explicit rather than relying on the "no role means student" default.
    app_metadata: { role: "student" },
    user_metadata: { first_name: record.first_name, last_name: record.last_name },
  });

  if (error || !data.user) {
    if (alreadyRegistered(error)) {
      return { status: "exists", message: `${record.student_number} already has an account.` };
    }
    console.error("[accounts] createUser failed", record.student_number, error);
    return { status: "error", message: "The account could not be created." };
  }

  const { error: insertError } = await loose(admin).from("account_invitations").insert({
    batch_id: options.batchId ?? null,
    user_id: data.user.id,
    student_number: record.student_number,
    first_name: record.first_name,
    last_name: record.last_name,
    program: record.program,
    year_level: record.year_level,
    section: record.section,
    delivery_email: record.email,
    status: options.password ? "password_issued" : "queued",
    created_by: options.createdBy,
  });

  if (insertError) {
    console.error("[accounts] invitation insert failed; rolling back", record.student_number, insertError);
    await admin.auth.admin.deleteUser(data.user.id);
    return { status: "error", message: "The account could not be recorded, so it was not created." };
  }

  return { status: "created", userId: data.user.id };
}

export interface StaffAccountInput {
  loginId: string;
  fullName: string;
  department: string;
  position: string;
  office: string | null;
  roleType: StaffRole;
  canAccessConfidential: boolean;
  password: string;
}

/**
 * One staff account, with the two things a staff login needs and that were
 * easy to get half right by hand: app_metadata.role, which admits it to
 * /staff, and a staff row whose role_type decides what it can see. A staff
 * login without the second is locked out of every OSA screen.
 *
 * Staff get a password set here and handed over in person, not an emailed
 * link: there are few of them, and they are onboarded face to face.
 */
export async function provisionStaff(input: StaffAccountInput): Promise<ProvisionOutcome> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: loginEmailFor(input.loginId),
    email_confirm: true,
    password: input.password,
    app_metadata: { role: input.roleType === "admin" ? "admin" : "staff" },
    user_metadata: { full_name: input.fullName },
  });

  if (error || !data.user) {
    if (alreadyRegistered(error)) {
      return { status: "exists", message: `${input.loginId} already has an account.` };
    }
    console.error("[accounts] createUser failed", input.loginId, error);
    return { status: "error", message: "The account could not be created." };
  }

  const { error: insertError } = await loose(admin).from("staff").insert({
    user_id: data.user.id,
    employee_id: input.loginId,
    full_name: input.fullName,
    department: input.department,
    position: input.position,
    office: input.office,
    role_type: input.roleType,
    can_access_confidential: input.canAccessConfidential,
  });

  if (insertError) {
    console.error("[accounts] staff insert failed; rolling back", input.loginId, insertError);
    await admin.auth.admin.deleteUser(data.user.id);
    const duplicate = (insertError as { code?: string }).code === "23505";
    return {
      status: "error",
      message: duplicate
        ? `A staff record with ID ${input.loginId} already exists.`
        : "The staff record could not be created, so the account was not created.",
    };
  }

  return { status: "created", userId: data.user.id };
}
