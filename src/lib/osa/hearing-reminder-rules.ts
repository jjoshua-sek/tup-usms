import { formatManila } from "@/lib/utils/time";

/**
 * When a hearing reminder is due, and how it reads. Pure — the clock is
 * passed in — so the rules can be tested without waiting for a hearing.
 * The sending lives in hearing-reminders.ts.
 */

/**
 * Columns the reminder job reads from case_hearings.
 * hearing-reminder-rules.test.ts checks them against the migrations.
 */
export const REMINDER_HEARING_COLUMNS =
  "id, case_id, status, scheduled_start, venue, student_notified_at, reminder_sent_at";

/** The student has been summoned and the hearing is still on. */
export const REMINDABLE_STATUSES = ["student_notified", "student_acknowledged", "confirmed"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LEAD_HOURS = 24;

/**
 * A summons sent this recently needs no reminder stacked on top of it. A
 * hearing summoned the evening before still gets one later, as long as it
 * has not started.
 */
export const FRESH_SUMMONS_MS = 3 * HOUR_MS;

/** How far ahead to remind: HEARING_REMINDER_HOURS, 1–72, default 24. */
export function reminderLeadHours(env: Record<string, string | undefined> = process.env): number {
  const configured = Number.parseInt(env.HEARING_REMINDER_HOURS ?? "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_LEAD_HOURS;
  return Math.min(72, Math.max(1, configured));
}

export interface HearingForReminder {
  status: string;
  scheduled_start: string;
  student_notified_at: string | null;
  reminder_sent_at: string | null;
}

export function isReminderDue(hearing: HearingForReminder, now: Date, leadHours: number): boolean {
  if (hearing.reminder_sent_at) return false;
  if (!(REMINDABLE_STATUSES as readonly string[]).includes(hearing.status)) return false;

  const start = new Date(hearing.scheduled_start).getTime();
  const nowMs = now.getTime();
  if (start <= nowMs) return false;
  if (start - nowMs > leadHours * HOUR_MS) return false;

  if (hearing.student_notified_at && nowMs - new Date(hearing.student_notified_at).getTime() < FRESH_SUMMONS_MS) {
    return false;
  }
  return true;
}

/** "today", "tomorrow" or "on Monday", by the Manila calendar. */
export function relativeDay(start: Date, now: Date): string {
  const day = (date: Date) => formatManila(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (day(start) === day(now)) return "today";
  if (day(start) === day(new Date(now.getTime() + 24 * HOUR_MS))) return "tomorrow";
  return `on ${formatManila(start, { weekday: "long" })}`;
}

/** "Thursday, October 8 at 2:00 PM" in Manila time — the hour on campus, not the server's. */
export function hearingWhen(start: Date): string {
  return formatManila(start, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}
