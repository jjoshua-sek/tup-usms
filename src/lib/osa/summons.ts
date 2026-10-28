import "server-only";

import { CLASSIFY_FIRST, isClassificationPending } from "@/lib/osa/classification";
import { needsComplainantApproval } from "@/lib/osa/hearing-approval";
import type { StaffContext } from "@/lib/osa/staff-context";
import { addCaseTimelineEntry } from "@/lib/osa/timeline";
import type { LooseClient } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { formatManila, formatManilaDateTime } from "@/lib/utils/time";
import type { CaseStatus } from "@/types/osa";

/**
 * Setting a hearing date, and summoning the student once the date stands.
 * Shared by the scheduler's proposals and by booking a date by hand, so the
 * two cannot drift apart. Not a "use server" module: these are internal
 * steps, never endpoints.
 *
 * The OSA head's review of the checklist (C1): a faculty complainant approves
 * the date before the student is told (needsComplainantApproval). Their
 * hearing waits at awaiting_complainant and they are asked to approve it;
 * approveHearing then sends the summons. Every other hearing is summoned at
 * once.
 */

/** Codes meaning migration 00038 has not run: no date_set_* columns, or the old approval constraint. */
const NEEDS_00038 = new Set(["PGRST204", "42703", "23514"]);

export async function createHearingWithSummons(
  db: LooseClient,
  staff: StaffContext,
  hearing: {
    caseId: string;
    hearingType: string;
    start: string;
    end: string;
    venue: string;
    proposedBy: "system" | "staff";
    /** For the timeline: why this time, or why it was set by hand. */
    note?: string | null;
  },
): Promise<{ hearingId: string; awaitingApproval: boolean } | { error: string }> {
  // "*" so classification_pending (00049) is read when it exists, without failing before it does.
  const { data: caseRow } = await db
    .from("violation_cases")
    .select("*, students(user_id)")
    .eq("id", hearing.caseId)
    .maybeSingle();
  const violationCase = caseRow as {
    case_number: string;
    status: CaseStatus;
    complainant_staff_id: string | null;
    complainant_name: string | null;
    classification_pending?: boolean;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };
  if (isClassificationPending(violationCase)) return { error: CLASSIFY_FIRST };

  const { data: complainantRow } = violationCase.complainant_staff_id
    ? await db.from("staff").select("user_id, full_name, role_type").eq("id", violationCase.complainant_staff_id).maybeSingle()
    : { data: null };
  const complainant = complainantRow as { user_id: string; full_name: string; role_type: string } | null;
  const awaitingApproval = needsComplainantApproval({
    hearingType: hearing.hearingType,
    complainantRole: complainant?.role_type ?? null,
  });

  const now = new Date().toISOString();
  const { data: inserted, error } = await db
    .from("case_hearings")
    .insert({
      case_id: hearing.caseId,
      hearing_type: hearing.hearingType,
      scheduled_start: hearing.start,
      scheduled_end: hearing.end,
      venue: hearing.venue,
      status: awaitingApproval ? "awaiting_complainant" : "student_notified",
      proposed_by: hearing.proposedBy,
      date_set_by: staff.staffId,
      date_set_at: now,
      ...(awaitingApproval
        ? {}
        : { student_notified_at: now, notified_via_portal: true, notified_via_email: true }),
    })
    .select("id")
    .single();
  if (error) {
    return {
      error: NEEDS_00038.has((error as { code?: string }).code ?? "")
        ? "Setting hearing dates needs migration 00038. Ask the administrator to run it."
        : "Could not create the hearing.",
    };
  }
  const hearingId = (inserted as { id: string }).id;

  await addCaseTimelineEntry(db, {
    caseId: hearing.caseId,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: awaitingApproval ? "slots_proposed" : "status_changed",
    summary: `${staff.fullName} ${awaitingApproval ? "proposed" : "set"} the meeting for ${formatManilaDateTime(hearing.start)} at ${hearing.venue}.${
      hearing.proposedBy === "staff" && hearing.note ? ` Set by hand: ${hearing.note}` : ""
    }${awaitingApproval ? ` Waiting for ${complainant?.full_name ?? "the complainant"} to approve the date.` : ""}`,
    details: { proposed_by: hearing.proposedBy, rationale: hearing.note ?? null, awaiting_complainant: awaitingApproval },
  });
  await logAuditEvent(staff.userId, "hearing_scheduled", "case_hearings", {
    case_id: hearing.caseId,
    hearing_id: hearingId,
    manual: hearing.proposedBy === "staff",
    awaiting_complainant: awaitingApproval,
  });

  if (awaitingApproval && complainant) {
    const when = formatManila(hearing.start, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    await db.rpc("create_notification", {
      p_user_id: complainant.user_id,
      p_type: "schedule_approval_needed",
      p_title: "Approve the hearing date for your complaint",
      p_body: `The OSA proposes ${when} at ${hearing.venue} for case ${violationCase.case_number}. The student is summoned once you approve it.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/staff/hearings",
      p_action_label: "Review the date",
      p_entity_type: "case_hearing",
      p_entity_id: hearingId,
    });
    return { hearingId, awaitingApproval: true };
  }

  await announceSummons(db, staff, {
    hearingId,
    caseId: hearing.caseId,
    start: hearing.start,
    venue: hearing.venue,
    caseNumber: violationCase.case_number,
    caseStatus: violationCase.status,
    studentUserId: violationCase.students?.user_id ?? null,
    hearingType: hearing.hearingType,
  });
  return { hearingId, awaitingApproval: false };
}

/**
 * Everything that follows a recorded summons: the student's notice (portal
 * and email), the case moving to summons_sent, the timeline and the audit.
 */
export async function announceSummons(
  db: LooseClient,
  staff: StaffContext,
  hearing: {
    hearingId: string;
    caseId: string;
    start: string;
    venue: string;
    caseNumber: string;
    caseStatus: CaseStatus | null;
    studentUserId: string | null;
    hearingType: string;
  },
): Promise<void> {
  // A minor case's counselling is its own step; every other meeting is the summons of the major path.
  const caseStatus: CaseStatus = hearing.hearingType === "counselling" ? "counselling_scheduled" : "summons_sent";

  // This string is emailed as the summons, so the hour must be the campus
  // hour, not the server's.
  const when = formatManila(hearing.start, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (hearing.studentUserId) {
    await db.rpc("create_notification", {
      p_user_id: hearing.studentUserId,
      p_type: "hearing_scheduled",
      p_title: "You have a meeting with the Office of Student Affairs",
      p_body: `${when} at ${hearing.venue}, regarding case ${hearing.caseNumber}. Please open the portal and confirm you've seen this.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/appointments",
      p_action_label: "View and acknowledge",
      p_entity_type: "case_hearing",
      p_entity_id: hearing.hearingId,
    });
  }

  await db.from("violation_cases").update({ status: caseStatus }).eq("id", hearing.caseId);

  await addCaseTimelineEntry(db, {
    caseId: hearing.caseId,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "student_notified",
    summary: `Summons sent for ${when} at ${hearing.venue}.`,
    fromStatus: hearing.caseStatus,
    toStatus: caseStatus,
  });

  await logAuditEvent(staff.userId, "hearing_notified", "case_hearings", {
    hearing_id: hearing.hearingId,
    case_id: hearing.caseId,
  });
}
