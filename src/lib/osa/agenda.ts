import { HEARING_STATUS_LABELS, type HearingStatus } from "@/types/osa";
import { manilaWallClock, startOfManilaDay } from "@/lib/utils/time";

/**
 * The OSA calendar: what is coming up, and what has passed without being
 * recorded. Pure — rows and the clock come in, entries come out — so the
 * rules for "overdue" can be tested without a database.
 *
 * Every date here is a Manila date. Timestamps (hearings, sessions) are
 * placed on the Manila day they fall on; DATE columns (deadlines) already
 * are Manila dates and are compared as such.
 */

/**
 * What the calendar page selects from each table. Kept here so agenda.test.ts
 * can check every column against the migrations: queries naming a column
 * that a migration dropped or never added have broken pages here before.
 */
export const AGENDA_COLUMNS = {
  case_hearings:
    "id, case_id, hearing_type, scheduled_start, scheduled_end, venue, status, violation_cases(case_number, students(first_name, last_name))",
  guidance_sessions: "id, scheduled_at, status, session_type, students(first_name, last_name)",
  risk_interventions: "id, scheduled_for, status, intervention_type, students(first_name, last_name)",
  case_appeals: "id, case_id, appeal_deadline, status, violation_cases(case_number, students(first_name, last_name))",
  community_service_assignments:
    "id, case_id, deadline, status, hours_required, hours_completed, violation_cases(case_number), students(first_name, last_name)",
} as const;

export interface AgendaSources {
  hearings: Array<{
    id: string;
    case_id: string;
    hearing_type: string;
    scheduled_start: string;
    scheduled_end: string;
    venue: string;
    status: string;
    case_number: string | null;
    student: string | null;
  }>;
  sessions: Array<{
    id: string;
    scheduled_at: string | null;
    status: string;
    session_type: string;
    student: string | null;
  }>;
  interventions: Array<{
    id: string;
    scheduled_for: string | null;
    status: string;
    intervention_type: string;
    student: string | null;
  }>;
  appeals: Array<{
    id: string;
    case_id: string;
    appeal_deadline: string;
    status: string;
    case_number: string | null;
    student: string | null;
  }>;
  services: Array<{
    id: string;
    case_id: string;
    deadline: string | null;
    status: string;
    hours_required: number;
    hours_completed: number;
    case_number: string | null;
    student: string | null;
  }>;
}

export type AgendaKind = "hearing" | "session" | "intervention" | "appeal" | "service";
export type AgendaTone = "info" | "warning" | "danger" | "neutral";

export interface AgendaEntry {
  key: string;
  kind: AgendaKind;
  /** Manila calendar date, YYYY-MM-DD. */
  day: string;
  /** The instant, for timed entries; null for an all-day deadline. */
  at: string | null;
  title: string;
  detail: string;
  href: string;
  badge: { label: string; tone: AgendaTone } | null;
}

/** Hearings the student has been, or is about to be, summoned to. */
const LIVE_HEARING = new Set(["awaiting_complainant", "complainant_approved", "student_notified", "student_acknowledged", "confirmed"]);
const NOT_YET_SUMMONED = new Set(["awaiting_complainant", "complainant_approved"]);
const OPEN_SERVICE = new Set(["assigned", "in_progress"]);

/** "2026-10-07" for the Manila day an instant falls on. */
export function manilaDay(date: Date): string {
  const { year, month, day } = manilaWallClock(date);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const humanize = (value: string) => {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const who = (student: string | null) => student ?? "A student";
const caseLabel = (caseNumber: string | null) => caseNumber ?? "a case";

function hearingTone(status: string): AgendaTone {
  if (NOT_YET_SUMMONED.has(status)) return "warning";
  if (status === "student_notified") return "info";
  return "neutral";
}

/** Everything scheduled from today through the next `days` days, by Manila day. */
export function upcomingAgenda(
  sources: AgendaSources,
  now: Date,
  days = 14,
): Array<{ day: string; entries: AgendaEntry[] }> {
  const from = startOfManilaDay(now);
  const until = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  const firstDay = manilaDay(from);
  const lastDay = manilaDay(new Date(until.getTime() - 1));
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= now.getTime() && t < until.getTime();
  };
  const dayInWindow = (day: string) => day >= firstDay && day <= lastDay;

  const entries: AgendaEntry[] = [];

  for (const h of sources.hearings) {
    if (!LIVE_HEARING.has(h.status) || !inWindow(h.scheduled_start)) continue;
    entries.push({
      key: `hearing-${h.id}`,
      kind: "hearing",
      day: manilaDay(new Date(h.scheduled_start)),
      at: h.scheduled_start,
      title: `${humanize(h.hearing_type)} · ${caseLabel(h.case_number)}`,
      detail: `${who(h.student)} · ${h.venue}`,
      href: `/staff/cases/${h.case_id}`,
      badge: { label: HEARING_STATUS_LABELS[h.status as HearingStatus] ?? humanize(h.status), tone: hearingTone(h.status) },
    });
  }

  for (const s of sources.sessions) {
    if (s.status !== "scheduled" || !s.scheduled_at || !inWindow(s.scheduled_at)) continue;
    entries.push({
      key: `session-${s.id}`,
      kind: "session",
      day: manilaDay(new Date(s.scheduled_at)),
      at: s.scheduled_at,
      title: "Guidance session",
      detail: `${who(s.student)} · ${humanize(s.session_type)}`,
      href: "/staff/guidance",
      badge: null,
    });
  }

  for (const i of sources.interventions) {
    if (!["approved", "scheduled"].includes(i.status) || !i.scheduled_for || !inWindow(i.scheduled_for)) continue;
    entries.push({
      key: `intervention-${i.id}`,
      kind: "intervention",
      day: manilaDay(new Date(i.scheduled_for)),
      at: i.scheduled_for,
      title: humanize(i.intervention_type),
      detail: who(i.student),
      href: "/staff/interventions",
      badge: null,
    });
  }

  for (const a of sources.appeals) {
    if (a.status !== "window_open" || !dayInWindow(a.appeal_deadline)) continue;
    entries.push({
      key: `appeal-${a.id}`,
      kind: "appeal",
      day: a.appeal_deadline,
      at: null,
      title: `Appeal window closes · ${caseLabel(a.case_number)}`,
      detail: who(a.student),
      href: `/staff/cases/${a.case_id}`,
      badge: { label: "Deadline", tone: "warning" },
    });
  }

  for (const s of sources.services) {
    if (!OPEN_SERVICE.has(s.status) || !s.deadline || !dayInWindow(s.deadline)) continue;
    entries.push({
      key: `service-${s.id}`,
      kind: "service",
      day: s.deadline,
      at: null,
      title: `Community service due · ${caseLabel(s.case_number)}`,
      detail: `${who(s.student)} · ${s.hours_completed} of ${s.hours_required} hours recorded`,
      href: `/staff/cases/${s.case_id}`,
      badge: { label: "Deadline", tone: "warning" },
    });
  }

  // All-day deadlines first within a day, then timed entries in order.
  entries.sort((x, y) => x.day.localeCompare(y.day) || (x.at ?? "").localeCompare(y.at ?? ""));

  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  return [...byDay].map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}

/**
 * What has passed without anyone recording what happened: a hearing date
 * gone by with the hearing still open, an appeal window or service deadline
 * passed with nothing logged, a session or intervention left "scheduled".
 *
 * Nothing here changes a record by itself. Whether an appeal was filed with
 * the VPAA, or service hours were served elsewhere, is for a person to
 * record; the calendar only makes sure someone is asked.
 */
export function needsAttention(sources: AgendaSources, now: Date): AgendaEntry[] {
  const today = manilaDay(now);
  const startOfToday = startOfManilaDay(now).getTime();
  const entries: AgendaEntry[] = [];

  for (const h of sources.hearings) {
    if (!LIVE_HEARING.has(h.status) || new Date(h.scheduled_end).getTime() > now.getTime()) continue;
    const notSummoned = NOT_YET_SUMMONED.has(h.status);
    entries.push({
      key: `hearing-${h.id}`,
      kind: "hearing",
      day: manilaDay(new Date(h.scheduled_start)),
      at: h.scheduled_start,
      title: notSummoned
        ? `Hearing slot passed before the summons went out · ${caseLabel(h.case_number)}`
        : `Hearing passed without an outcome · ${caseLabel(h.case_number)}`,
      detail: notSummoned
        ? `${who(h.student)}. Book a new date.`
        : `${who(h.student)}. Record what happened, or that someone did not attend.`,
      href: `/staff/cases/${h.case_id}`,
      badge: { label: notSummoned ? "Rebook" : "Record outcome", tone: "danger" },
    });
  }

  for (const a of sources.appeals) {
    if (a.status !== "window_open" || a.appeal_deadline >= today) continue;
    entries.push({
      key: `appeal-${a.id}`,
      kind: "appeal",
      day: a.appeal_deadline,
      at: null,
      title: `Appeal window closed · ${caseLabel(a.case_number)}`,
      detail: `Record whether ${who(a.student)} filed an appeal, or that the window lapsed.`,
      href: `/staff/cases/${a.case_id}`,
      badge: { label: "Record result", tone: "danger" },
    });
  }

  for (const s of sources.services) {
    if (!OPEN_SERVICE.has(s.status) || !s.deadline || s.deadline >= today) continue;
    entries.push({
      key: `service-${s.id}`,
      kind: "service",
      day: s.deadline,
      at: null,
      title: `Community service past its deadline · ${caseLabel(s.case_number)}`,
      detail: `${who(s.student)} · ${s.hours_completed} of ${s.hours_required} hours recorded. Update the hours or mark it not served.`,
      href: `/staff/cases/${s.case_id}`,
      badge: { label: "Overdue", tone: "danger" },
    });
  }

  for (const s of sources.sessions) {
    if (s.status !== "scheduled" || !s.scheduled_at || new Date(s.scheduled_at).getTime() >= startOfToday) continue;
    entries.push({
      key: `session-${s.id}`,
      kind: "session",
      day: manilaDay(new Date(s.scheduled_at)),
      at: s.scheduled_at,
      title: "Guidance session not recorded",
      detail: `${who(s.student)}. Mark it completed, missed or rescheduled.`,
      href: "/staff/guidance",
      badge: { label: "Record", tone: "warning" },
    });
  }

  for (const i of sources.interventions) {
    if (i.status !== "scheduled" || !i.scheduled_for || new Date(i.scheduled_for).getTime() >= startOfToday) continue;
    entries.push({
      key: `intervention-${i.id}`,
      kind: "intervention",
      day: manilaDay(new Date(i.scheduled_for)),
      at: i.scheduled_for,
      title: `${humanize(i.intervention_type)} date passed`,
      detail: `${who(i.student)}. Update its status.`,
      href: "/staff/interventions",
      badge: { label: "Update", tone: "warning" },
    });
  }

  // Oldest first: the longest-forgotten item is the most urgent.
  return entries.sort((x, y) => x.day.localeCompare(y.day) || (x.at ?? "").localeCompare(y.at ?? ""));
}
