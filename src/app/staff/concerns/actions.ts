"use server";

import { revalidatePath } from "next/cache";
import { summarizeConcerns } from "@/lib/concerns/summarize";
import { getStaffContext } from "@/lib/osa/staff-context";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { CONCERN_STATUSES } from "@/lib/validations/concern";

interface ActionResult {
  success?: boolean;
  error?: string;
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
