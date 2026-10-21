"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { referralRationale, staffConcernSchema } from "@/lib/concerns/intake";
import { summarizeConcerns } from "@/lib/concerns/summarize";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";
import { CONCERN_STATUSES } from "@/lib/validations/concern";

interface ActionResult {
  success?: boolean;
  error?: string;
}

interface RecordResult {
  concernId?: string;
  /** Set when the student was also queued for a guidance referral. */
  flagged?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/**
 * Records a concern a student raised at the counter, by letter or email, or
 * through a faculty member (OSA checklist D2 and E1). It joins the same
 * queue and AI summary as one from the online form, and the student sees it
 * in their portal. A faculty referral can also put the student on the
 * At-Risk follow-up list as a recommended guidance referral.
 */
export async function recordConcern(formData: FormData): Promise<RecordResult> {
  const staff = await getStaffContext();
  if (!staff || !(staff.isOsa || staff.isCounselor)) {
    return { error: "Only OSA staff can record a concern for a student." };
  }

  const parsed = staffConcernSchema.safeParse({
    student_number: formData.get("student_number") ?? "",
    received_via: formData.get("received_via") ?? "",
    referred_by: formData.get("referred_by") ?? "",
    follow_up: formData.get("follow_up") === "on",
    category: formData.get("category") ?? "",
    subject_line: formData.get("subject_line") ?? "",
    body_text: formData.get("body_text") ?? "",
  });
  if (!parsed.success) {
    return { error: "Please check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id, first_name, last_name")
    .eq("student_number", input.student_number)
    .maybeSingle();
  const student = studentRow as { id: string; first_name: string; last_name: string } | null;
  if (!student) {
    return {
      error: `No student ${input.student_number} in STARS. Their account must exist first (Staff → Accounts).`,
      fieldErrors: { student_number: ["Not found."] },
    };
  }

  const subject = sanitizeText(input.subject_line, 200);
  const { data: inserted, error } = await db
    .from("concerns")
    .insert({
      student_id: student.id,
      category: input.category,
      subject_line: subject,
      body_text: sanitizeText(input.body_text, 10000),
      status: "pending",
      received_via: input.received_via,
      recorded_by: staff.staffId,
      referred_by: input.referred_by ? sanitizeText(input.referred_by, 120) : null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[concerns] staff record failed", error);
    return { error: "The concern was not saved. Please try again." };
  }
  const concernId = (inserted as { id: string }).id;

  let flagged = false;
  if (input.follow_up && input.referred_by) {
    const { error: referralError } = await db.from("risk_interventions").insert({
      student_id: student.id,
      intervention_type: "guidance_referral",
      rationale: referralRationale(input.referred_by, subject),
      status: "recommended",
      priority: "normal",
      created_by: staff.staffId,
    });
    // The concern is saved either way; say so if the flag did not stick.
    if (referralError) console.error("[concerns] referral follow-up not queued", referralError);
    flagged = !referralError;
  }

  after(() => summarizeConcerns({ concernId, limit: 1 }));

  await logAuditEvent(staff.userId, "concern_submit", `concerns/${concernId}`, {
    recorded_for: input.student_number,
    received_via: input.received_via,
    referred_by: input.referred_by,
    follow_up: flagged,
  });

  revalidatePath("/staff/concerns");
  revalidatePath("/staff/interventions");
  revalidatePath("/concerns");
  return { concernId, flagged };
}

/**
 * Update the status of a concern (staff only).
 *
 * RLS already restricts UPDATE on concerns to staff/admin roles, so
 * the client-side staff layout gate + this RLS policy form a defense-in-depth pair.
 *
 * Audit logged for accountability — every status change is traceable to a user.
 */
export async function updateConcernStatus(
  concernId: string,
  newStatus: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  // Validate status against the allowed enum
  if (!(CONCERN_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "Invalid status value." };
  }

  // Look up which staff member is doing the update
  const { data: staffRaw } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const staff = staffRaw as { id: string } | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const updatePayload: Record<string, any> = { status: newStatus };
  // Auto-assign on transition to in_review if no one is assigned yet
  if (newStatus === "in_review" && staff) {
    updatePayload.assigned_to = staff.id;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("concerns")
    .update(updatePayload)
    .eq("id", concernId);

  if (error) {
    console.error("Status update failed:", error);
    return { error: "Failed to update status." };
  }

  await logAuditEvent(
    user.id,
    "concern_respond",
    `concerns/${concernId}`,
    { newStatus, byStaffId: staff?.id }
  );

  // Revalidate both staff and student views
  revalidatePath(`/staff/concerns/${concernId}`);
  revalidatePath("/staff/concerns");
  revalidatePath(`/concerns/${concernId}`);
  revalidatePath("/concerns");

  return { success: true };
}

/**
 * Re-runs the AI summary for one concern — after a failure, or when staff
 * want the AI to take another look. Staff wait for the result, so it runs
 * now rather than after the response.
 *
 * Restricted to staff. It used to check only that someone was signed in,
 * so any student could call it with any concern id and spend the AI budget.
 */
export async function resummarizeConcern(concernId: string): Promise<ActionResult> {
  const staff = await getStaffContext();
  if (!staff) return { error: "Only staff can re-run the AI summary." };
  if (!/^[0-9a-f-]{36}$/i.test(concernId)) return { error: "Concern not found." };

  const report = await summarizeConcerns({ concernId, force: true, limit: 1 });
  if (report.held) {
    return {
      error:
        report.held === "migration 00023 has not been run"
          ? "Run migration 00023 in Supabase first — AI summaries need it."
          : "Could not start the AI summary. Try again.",
    };
  }

  const outcome = report.outcomes[0];
  if (!outcome) return { error: "Concern not found." };
  if (!outcome.ok) return { error: outcome.error ?? "The AI summary failed." };

  await logAuditEvent(staff.userId, "concern_respond", `concerns/${concernId}`, {
    action: "manual_resummarize",
  });

  revalidatePath(`/staff/concerns/${concernId}`);
  revalidatePath("/staff/concerns");
  revalidatePath(`/concerns/${concernId}`);
  return { success: true };
}
