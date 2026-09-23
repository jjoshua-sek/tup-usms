"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

interface ClearanceCheck {
  result:
    | "clear"
    | "has_pending_cases"
    | "has_unresolved_sanctions"
    | "has_unserved_sanctions";
  pending_cases: number;
  unresolved_sanctions: number;
  unsubmitted_apologies: number;
  /** Community service assignments still outstanding (migration 00018). */
  unserved_service?: number;
  blocking_cases: Array<{
    case_id: string;
    case_number: string;
    classification: string;
    status: string;
  }>;
}

/**
 * Runs the automated record check and turns each blocker into a hold the
 * student can actually act on.
 *
 * The SQL function (`check_student_clearance`, migration 00010) answers "is
 * this student clear?". The value added here is the second half: every
 * blocker becomes a `clearance_holds` row carrying *resolution instructions*,
 * because "you have a pending case" tells a graduating student nothing about
 * what to do next.
 */
export async function runClearanceCheck(requestId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can verify clearance." };

  const db = loose(createAdminClient());

  const { data: requestRow } = await db
    .from("clearance_requests")
    .select("id, student_id, status")
    .eq("id", requestId)
    .maybeSingle();

  const request = requestRow as { id: string; student_id: string; status: string } | null;
  if (!request) return { error: "Request not found." };

  const { data: checkData, error: checkError } = await db.rpc("check_student_clearance", {
    p_student_id: request.student_id,
  });
  if (checkError) return { error: "The record check failed. Try again." };

  const check = checkData as ClearanceCheck;
  const unservedService = check.unserved_service ?? 0;
  const isClear =
    check.result === "clear" && check.unsubmitted_apologies === 0 && unservedService === 0;

  await db
    .from("clearance_requests")
    .update({
      status: isClear ? "cleared" : "on_hold",
      auto_check_result: check.result,
      auto_check_details: check,
      auto_checked_at: new Date().toISOString(),
      verified_by: staff.staffId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (!isClear) {
    // Replace the auto-generated holds so a re-run reflects what is still
    // outstanding; holds an officer placed by hand are left alone.
    await db
      .from("clearance_holds")
      .delete()
      .eq("clearance_request_id", requestId)
      .is("resolved_at", null)
      .eq("placed_by", staff.staffId);

    interface HoldInsert {
      clearance_request_id: string;
      hold_reason: string;
      related_case_id: string | null;
      description: string;
      resolution_instructions: string;
      responsible_office: string;
      placed_by: string;
    }

    const holds: HoldInsert[] = check.blocking_cases.map((blocker) => ({
      clearance_request_id: requestId,
      hold_reason:
        blocker.status === "sanctioned"
          ? "unresolved_sanction"
          : blocker.status === "awaiting_apology"
            ? "unsubmitted_apology_letter"
            : "pending_violation_case",
      related_case_id: blocker.case_id,
      description: `Case ${blocker.case_number} (${blocker.classification}) is still ${blocker.status.replace(/_/g, " ")}.`,
      resolution_instructions:
        blocker.status === "awaiting_apology"
          ? "Submit your apology letter through the portal and wait for the OSA to accept it."
          : blocker.status === "sanctioned"
            ? "Complete the sanction, then ask the OSA officer handling your case to close it."
            : "Attend the scheduled meeting for this case. Clearance resumes once the case is closed or dismissed.",
      responsible_office: "Office of Student Affairs",
      placed_by: staff.staffId,
    }));

    // Outstanding community service blocks clearance in its own right — the
    // case may be closed while the hours are not yet served.
    if (unservedService > 0) {
      const { data: serviceRows } = await db
        .from("community_service_assignments")
        .select("id, hours_required, hours_completed, deadline, service_detail")
        .eq("student_id", request.student_id)
        .in("status", ["assigned", "in_progress", "not_served"]);

      for (const row of (serviceRows as Array<{
        hours_required: number;
        hours_completed: number;
        deadline: string | null;
        service_detail: string | null;
      }> | null) ?? []) {
        const remaining = Math.max(row.hours_required - Number(row.hours_completed), 0);
        holds.push({
          clearance_request_id: requestId,
          hold_reason: "unserved_community_service",
          related_case_id: null,
          description: `${remaining} of ${row.hours_required} community service hours are still outstanding.`,
          resolution_instructions: `Complete the remaining ${remaining} hours${row.service_detail ? ` (${row.service_detail})` : ""}, have the office where you served sign off, then bring the signed record to the OSA.${row.deadline ? ` The deadline is ${row.deadline}.` : ""}`,
          responsible_office: "Office of Student Affairs",
          placed_by: staff.staffId,
        });
      }
    }

    if (holds.length > 0) {
      await db.from("clearance_holds").insert(holds);
    }
  }

  await logAuditEvent(staff.userId, "clearance_reviewed", "clearance_requests", {
    request_id: requestId,
    result: check.result,
  });

  revalidatePath("/staff/clearance");
  return {
    ok: true,
    message: isClear
      ? "Record is clear."
      : `${check.blocking_cases.length} blocker(s) recorded as holds.`,
  };
}

export async function resolveClearanceHold(
  holdId: string,
  notes?: string,
): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can clear a hold." };

  const db = loose(createAdminClient());

  const { data: holdRow } = await db
    .from("clearance_holds")
    .select("id, clearance_request_id")
    .eq("id", holdId)
    .maybeSingle();
  const hold = holdRow as { id: string; clearance_request_id: string } | null;
  if (!hold) return { error: "Hold not found." };

  const { error } = await db
    .from("clearance_holds")
    .update({
      resolved_by: staff.staffId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes ? sanitizeText(notes, 500) : null,
    })
    .eq("id", holdId);

  if (error) return { error: "Could not clear that hold." };

  // When the last hold goes, the request moves on by itself — leaving it at
  // "on hold" with nothing holding it is how students end up queueing at the
  // window to ask why.
  const { count } = await db
    .from("clearance_holds")
    .select("id", { count: "exact", head: true })
    .eq("clearance_request_id", hold.clearance_request_id)
    .is("resolved_at", null);

  if ((count ?? 0) === 0) {
    await db
      .from("clearance_requests")
      .update({ status: "cleared" })
      .eq("id", hold.clearance_request_id);
  }

  revalidatePath("/staff/clearance");
  return { ok: true, message: "Hold cleared." };
}

const advanceSchema = z.object({
  request_id: z.string().uuid(),
  status: z.enum(["verifying", "fee_pending", "ready", "issued", "rejected"]),
  certificate_number: z.string().trim().max(60).optional().or(z.literal("")),
  or_number: z.string().trim().max(60).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Moves a request along the fee → ready → issued path. */
export async function advanceClearance(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can update clearance." };

  const parsed = advanceSchema.safeParse({
    request_id: formData.get("request_id"),
    status: formData.get("status"),
    certificate_number: formData.get("certificate_number") ?? "",
    or_number: formData.get("or_number") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Invalid update." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: parsed.data.status };

  if (parsed.data.certificate_number) patch.certificate_number = parsed.data.certificate_number;
  if (parsed.data.or_number) {
    patch.or_number = parsed.data.or_number;
    patch.fee_paid_at = now;
    patch.fee_confirmed_by = staff.staffId;
  }
  if (parsed.data.status === "issued") {
    patch.issued_at = now;
    patch.issued_by = staff.staffId;
  }
  if (parsed.data.status === "rejected") {
    patch.rejection_reason = parsed.data.note
      ? sanitizeText(parsed.data.note, 500)
      : "Rejected by the OSA.";
  } else if (parsed.data.note) {
    patch.verification_notes = sanitizeText(parsed.data.note, 500);
  }

  const db = loose(createAdminClient());
  const { error } = await db
    .from("clearance_requests")
    .update(patch)
    .eq("id", parsed.data.request_id);

  if (error) return { error: "Could not update the request." };

  // Tell the student, so "ready for pickup" doesn't depend on them checking.
  const { data: requestRow } = await db
    .from("clearance_requests")
    .select("request_number, students(user_id)")
    .eq("id", parsed.data.request_id)
    .maybeSingle();

  const request = requestRow as {
    request_number: string;
    students: { user_id: string } | null;
  } | null;

  if (request?.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: request.students.user_id,
      p_type: "clearance_update",
      p_title: `Clearance ${parsed.data.status.replace(/_/g, " ")}`,
      p_body: `Request ${request.request_number} is now ${parsed.data.status.replace(/_/g, " ")}. Open your clearance page for the next step.`,
      p_priority: parsed.data.status === "ready" ? "high" : "normal",
      p_channels: ["in_app", "email"],
      p_action_url: "/clearance",
      p_action_label: "View clearance",
      p_entity_type: "clearance_request",
      p_entity_id: parsed.data.request_id,
    });
  }

  await logAuditEvent(staff.userId, "clearance_reviewed", "clearance_requests", {
    request_id: parsed.data.request_id,
    status: parsed.data.status,
  });

  revalidatePath("/staff/clearance");
  return { ok: true, message: "Updated." };
}
