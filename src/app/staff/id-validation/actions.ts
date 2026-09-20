"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { defaultTermExpiry, getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import type { IdValidationStatus } from "@/types/osa";

interface Result {
  ok?: boolean;
  error?: string;
}

const reviewSchema = z.object({
  validation_id: z.string().uuid(),
  decision: z.enum(["validate", "reject", "suspend", "revoke", "reinstate"]),
  sticker_number: z.string().trim().max(40).optional().or(z.literal("")),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Status the decision moves the row to, and what the student is told. */
const DECISION_MAP: Record<
  string,
  { status: IdValidationStatus; title: string; body: string; needsReason: boolean }
> = {
  validate: {
    status: "validated",
    title: "Your ID is validated",
    body: "Your TUP ID is now valid for this term and will open the campus turnstiles.",
    needsReason: false,
  },
  reject: {
    status: "rejected",
    title: "ID validation needs attention",
    body: "The OSA could not validate your ID. Open your Digital ID page for the reason and next step.",
    needsReason: true,
  },
  suspend: {
    status: "suspended",
    title: "Campus access suspended",
    body: "Your ID has been suspended. Please report to the Office of Student Affairs.",
    needsReason: true,
  },
  revoke: {
    status: "revoked",
    title: "ID revoked",
    body: "Your ID has been revoked. Request a replacement card at the OSA.",
    needsReason: true,
  },
  reinstate: {
    status: "validated",
    title: "Campus access restored",
    body: "Your ID is valid again and will open the campus turnstiles.",
    needsReason: false,
  },
};

/**
 * OSA decision on an ID validation request.
 *
 * This is the switch the turnstiles read: `verifyScan` looks for a row with
 * status 'validated' for the current term, so validating here is what makes a
 * card open a gate, and suspending here is what stops it — within seconds,
 * with no kiosk to visit.
 *
 * Runs on the service-role client after an explicit role check because it
 * also writes a notification to the student's own user id.
 */
export async function reviewIdValidation(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can review ID validations." };

  const parsed = reviewSchema.safeParse({
    validation_id: formData.get("validation_id"),
    decision: formData.get("decision"),
    sticker_number: formData.get("sticker_number") ?? "",
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: "Invalid review." };

  const decision = DECISION_MAP[parsed.data.decision];
  if (decision.needsReason && !parsed.data.reason) {
    return { error: "Give the student a reason — they see this on their ID page." };
  }

  const db = loose(createAdminClient());
  const term = getCurrentTerm();
  const now = new Date();

  const { data: rowData } = await db
    .from("id_validations")
    .select("id, student_id, students(user_id, student_number)")
    .eq("id", parsed.data.validation_id)
    .maybeSingle();

  const row = rowData as {
    id: string;
    student_id: string;
    students: { user_id: string; student_number: string } | null;
  } | null;
  if (!row) return { error: "That validation record no longer exists." };

  const patch: Record<string, unknown> = {
    status: decision.status,
    rejection_reason: decision.needsReason ? parsed.data.reason : null,
  };

  if (decision.status === "validated") {
    patch.validated_by = staff.staffId;
    patch.validated_at = now.toISOString();
    patch.expires_at = defaultTermExpiry(term).toISOString();
    if (parsed.data.sticker_number) {
      patch.validation_sticker_number = parsed.data.sticker_number;
    }
  }

  const { error } = await db
    .from("id_validations")
    .update(patch)
    .eq("id", parsed.data.validation_id);

  if (error) return { error: "Could not save that decision." };

  // Requirement #4: tell the student through the portal (and email, where
  // they've opted in — create_notification honours their preferences).
  if (row.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: row.students.user_id,
      p_type: "id_validation",
      p_title: decision.title,
      p_body: parsed.data.reason ? `${decision.body} Reason: ${parsed.data.reason}` : decision.body,
      p_priority: decision.status === "validated" ? "normal" : "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/id",
      p_action_label: "Open my Digital ID",
      p_entity_type: "id_validation",
      p_entity_id: parsed.data.validation_id,
    });
  }

  await logAuditEvent(staff.userId, "id_validation_reviewed", "id_validations", {
    validation_id: parsed.data.validation_id,
    decision: parsed.data.decision,
    student_number: row.students?.student_number,
  });

  revalidatePath("/staff/id-validation");
  revalidatePath("/staff/gates");
  return { ok: true };
}
