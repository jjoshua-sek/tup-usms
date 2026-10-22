import "server-only";

import type { StaffContext } from "@/lib/osa/staff-context";
import { addCaseTimelineEntry } from "@/lib/osa/timeline";
import type { LooseClient } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { formatManila, formatManilaDateTime } from "@/lib/utils/time";
import type { CaseStatus } from "@/types/osa";

/**
 * Setting a hearing date and summoning the student, in one step (OSA
 * checklist C1: the OSA sets the date; there is no complainant approval).
 * Shared by the scheduler's proposals and by booking a date by hand, so the
 * two cannot drift apart. Not a "use server" module: these are internal
 * steps, never endpoints.
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
): Promise<{ hearingId: string } | { error: string }> {
  const { data: caseRow } = await db
    .from("violation_cases")
    .select("case_number, status, students(user_id)")
    .eq("id", hearing.caseId)
    .maybeSingle();
  const violationCase = caseRow as { case_number: string; status: CaseStatus; students: { user_id: string } | null } | null;
  if (!violationCase) return { error: "Case not found." };

  const now = new Date().toISOString();
  const { data: inserted, error } = await db
    .from("case_hearings")
    .insert({
      case_id: hearing.caseId,
      hearing_type: hearing.hearingType,
      scheduled_start: hearing.start,
      scheduled_end: hearing.end,
      venue: hearing.venue,
      status: "student_notified",
      proposed_by: hearing.proposedBy,
      date_set_by: staff.staffId,
      date_set_at: now,
      student_notified_at: now,
      notified_via_portal: true,
      notified_via_email: true,
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
    eventType: "status_changed",
    summary: `${staff.fullName} set the meeting for ${formatManilaDateTime(hearing.start)} at ${hearing.venue}.${
      hearing.proposedBy === "staff" && hearing.note ? ` Set by hand: ${hearing.note}` : ""
    }`,
    details: { proposed_by: hearing.proposedBy, rationale: hearing.note ?? null },
  });
  await logAuditEvent(staff.userId, "hearing_scheduled", "case_hearings", {
    case_id: hearing.caseId,
    hearing_id: hearingId,
    manual: hearing.proposedBy === "staff",
  });

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
  return { hearingId };
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
