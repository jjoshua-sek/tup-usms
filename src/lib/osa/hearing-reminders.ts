import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";

import {
  REMINDABLE_STATUSES,
  REMINDER_HEARING_COLUMNS,
  hearingWhen,
  isReminderDue,
  relativeDay,
  reminderLeadHours,
} from "./hearing-reminder-rules";

/**
 * Reminds the student and the faculty complainant before a scheduled
 * hearing. Run every minute by the dispatch job; the notifications it
 * creates are emailed by the same run.
 *
 * 'hearing_reminder' is on the always-deliver list, so a student's email
 * settings cannot mute it — a reminder of a summons is part of the summons.
 */

export interface ReminderReport {
  sent: number;
  /** Why nothing could be checked this run, when that is the case. */
  held?: string;
}

interface HearingRow {
  id: string;
  case_id: string;
  status: string;
  scheduled_start: string;
  venue: string;
  student_notified_at: string | null;
  reminder_sent_at: string | null;
  violation_cases: {
    case_number: string;
    complainant_staff_id: string | null;
    students: { user_id: string } | null;
  } | null;
}

export async function sendHearingReminders(
  options: { now?: Date; leadHours?: number } = {},
): Promise<ReminderReport> {
  const now = options.now ?? new Date();
  const leadHours = options.leadHours ?? reminderLeadHours();
  const db = loose(createAdminClient());

  const { data, error } = await db
    .from("case_hearings")
    .select(`${REMINDER_HEARING_COLUMNS}, violation_cases(case_number, complainant_staff_id, students(user_id))`)
    .is("reminder_sent_at", null)
    .in("status", [...REMINDABLE_STATUSES])
    .gt("scheduled_start", now.toISOString())
    .lte("scheduled_start", new Date(now.getTime() + leadHours * 60 * 60 * 1000).toISOString())
    .order("scheduled_start")
    .limit(25);

  if (error) {
    // 42703: undefined column — the column this depends on isn't there yet.
    if ((error as { code?: string }).code === "42703") return { sent: 0, held: "run migration 00029" };
    console.error("[reminders] could not look up hearings", error);
    return { sent: 0, held: "lookup failed" };
  }

  const due = ((data as HearingRow[] | null) ?? []).filter((hearing) => isReminderDue(hearing, now, leadHours));
  if (due.length === 0) return { sent: 0 };

  // Faculty complainants are staff; their sign-in accounts come from one lookup.
  const complainantIds = [...new Set(due.map((h) => h.violation_cases?.complainant_staff_id).filter(Boolean))] as string[];
  const complainantUser = new Map<string, string>();
  if (complainantIds.length > 0) {
    const { data: staffRows } = await db.from("staff").select("id, user_id").in("id", complainantIds);
    for (const row of (staffRows as Array<{ id: string; user_id: string }> | null) ?? []) {
      complainantUser.set(row.id, row.user_id);
    }
  }

  let sent = 0;
  for (const hearing of due) {
    // Claim it. When two runs overlap, only one of them gets a row back.
    const { data: claimed, error: claimError } = await db
      .from("case_hearings")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", hearing.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (claimError || ((claimed as unknown[] | null) ?? []).length === 0) continue;

    const start = new Date(hearing.scheduled_start);
    const day = relativeDay(start, now);
    const when = hearingWhen(start);
    const caseNumber = hearing.violation_cases?.case_number ?? "your case";
    const studentUserId = hearing.violation_cases?.students?.user_id;

    if (studentUserId) {
      const { error: notifyError } = await db.rpc("create_notification", {
        p_user_id: studentUserId,
        p_type: "hearing_reminder",
        p_title: `Reminder: your meeting with the OSA is ${day}`,
        p_body: `${when} at ${hearing.venue}, regarding case ${caseNumber}. If you can't attend, contact the Office of Student Affairs before the meeting.`,
        p_priority: "high",
        p_channels: ["in_app", "email"],
        p_action_url: "/appointments",
        p_action_label: "View meeting details",
        p_entity_type: "case_hearing",
        p_entity_id: hearing.id,
      });

      if (notifyError) {
        // Give the claim back so the next run tries again; a reminder that
        // silently never went out is the failure this job exists to prevent.
        console.error("[reminders] student reminder not created", hearing.id, notifyError);
        await db.from("case_hearings").update({ reminder_sent_at: null }).eq("id", hearing.id);
        continue;
      }
    }

    const complainantId = hearing.violation_cases?.complainant_staff_id;
    const complainantUserId = complainantId ? complainantUser.get(complainantId) : undefined;
    if (complainantUserId) {
      const { error: staffNotifyError } = await db.rpc("create_notification", {
        p_user_id: complainantUserId,
        p_type: "hearing_reminder",
        p_title: `Reminder: hearing for case ${caseNumber} is ${day}`,
        p_body: `${when} at ${hearing.venue}.`,
        p_priority: "normal",
        p_channels: ["in_app", "email"],
        p_action_url: `/staff/cases/${hearing.case_id}`,
        p_action_label: "Open the case",
        p_entity_type: "case_hearing",
        p_entity_id: hearing.id,
      });
      // The student's reminder is the one that matters for due process; a
      // missed copy to the complainant is logged, not retried.
      if (staffNotifyError) console.error("[reminders] complainant reminder not created", hearing.id, staffNotifyError);
    }

    sent += 1;
  }

  return { sent };
}
