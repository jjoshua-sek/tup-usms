import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarCheck } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import {
  AGENDA_COLUMNS,
  manilaDay,
  needsAttention,
  upcomingAgenda,
  type AgendaEntry,
  type AgendaSources,
} from "@/lib/osa/agenda";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManila, formatManilaTime, manilaInstant } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Calendar",
};

export const dynamic = "force-dynamic";

const DAYS_AHEAD = 14;
/** How far back to look for things that passed unrecorded. */
const LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

type StudentName = { first_name: string; last_name: string } | null;
const fullName = (student: StudentName) => (student ? `${student.first_name} ${student.last_name}` : null);

/**
 * The OSA calendar: hearings, guidance sessions, interventions and
 * deadlines for the next two weeks, and everything that passed without
 * being recorded. Read through the viewer's own session, so each role sees
 * what RLS lets it see — a counselor's sessions, an officer's cases.
 */
export default async function StaffCalendarPage() {
  const staff = await getStaffContext();
  if (!staff) redirect("/staff/dashboard");

  const now = new Date();
  const until = new Date(now.getTime() + DAYS_AHEAD * DAY_MS).toISOString();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString();
  const untilDay = manilaDay(new Date(now.getTime() + DAYS_AHEAD * DAY_MS));
  const sinceDay = manilaDay(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS));

  const db = loose(await createClient());
  const [hearings, sessions, interventions, appeals, services] = await Promise.all([
    db
      .from("case_hearings")
      .select(AGENDA_COLUMNS.case_hearings)
      .in("status", ["awaiting_complainant", "complainant_approved", "student_notified", "student_acknowledged", "confirmed"])
      .gte("scheduled_start", since)
      .lte("scheduled_start", until),
    db
      .from("guidance_sessions")
      .select(AGENDA_COLUMNS.guidance_sessions)
      .eq("status", "scheduled")
      .gte("scheduled_at", since)
      .lte("scheduled_at", until),
    db
      .from("risk_interventions")
      .select(AGENDA_COLUMNS.risk_interventions)
      .in("status", ["approved", "scheduled"])
      .gte("scheduled_for", since)
      .lte("scheduled_for", until),
    db
      .from("case_appeals")
      .select(AGENDA_COLUMNS.case_appeals)
      .eq("status", "window_open")
      .gte("appeal_deadline", sinceDay)
      .lte("appeal_deadline", untilDay),
    db
      .from("community_service_assignments")
      .select(AGENDA_COLUMNS.community_service_assignments)
      .in("status", ["assigned", "in_progress"])
      .gte("deadline", sinceDay)
      .lte("deadline", untilDay),
  ]);

  for (const [name, result] of Object.entries({ hearings, sessions, interventions, appeals, services })) {
    if (result.error) console.error(`[calendar] ${name} not loaded`, result.error);
  }

  type CaseEmbed = { case_number: string; students?: StudentName } | null;
  const rows = <T,>(result: { data: unknown }) => ((result.data as T[] | null) ?? []);

  const sources: AgendaSources = {
    hearings: rows<{
      id: string; case_id: string; hearing_type: string; scheduled_start: string; scheduled_end: string;
      venue: string; status: string; violation_cases: CaseEmbed;
    }>(hearings).map((h) => ({
      ...h,
      case_number: h.violation_cases?.case_number ?? null,
      student: fullName(h.violation_cases?.students ?? null),
    })),
    sessions: rows<{ id: string; scheduled_at: string | null; status: string; session_type: string; students: StudentName }>(
      sessions,
    ).map((s) => ({ ...s, student: fullName(s.students) })),
    interventions: rows<{
      id: string; scheduled_for: string | null; status: string; intervention_type: string; students: StudentName;
    }>(interventions).map((i) => ({ ...i, student: fullName(i.students) })),
    appeals: rows<{ id: string; case_id: string; appeal_deadline: string; status: string; violation_cases: CaseEmbed }>(
      appeals,
    ).map((a) => ({
      ...a,
      case_number: a.violation_cases?.case_number ?? null,
      student: fullName(a.violation_cases?.students ?? null),
    })),
    services: rows<{
      id: string; case_id: string; deadline: string | null; status: string; hours_required: number;
      hours_completed: number; violation_cases: CaseEmbed; students: StudentName;
    }>(services).map((s) => ({
      ...s,
      hours_completed: Number(s.hours_completed),
      case_number: s.violation_cases?.case_number ?? null,
      student: fullName(s.students),
    })),
  };

  const overdue = needsAttention(sources, now);
  const days = upcomingAgenda(sources, now, DAYS_AHEAD);
  const today = manilaDay(now);
  const tomorrow = manilaDay(new Date(now.getTime() + DAY_MS));

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Overview", href: "/staff/dashboard" }, { label: "Calendar" }]}
        title="Calendar"
        description="Hearings, counselling, interventions and deadlines for the next two weeks — and anything that passed without being recorded."
      />

      {overdue.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            Needs attention
            <span className="text-sm font-normal text-muted-foreground">({overdue.length})</span>
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-red-200 bg-card">
            {overdue.map((entry) => (
              <EntryRow key={entry.key} entry={entry} when={entry.at ? formatManila(entry.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : dayLabel(entry.day)} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold">Next {DAYS_AHEAD} days</h2>
        {days.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing scheduled"
            description="Hearings, guidance sessions, interventions and deadlines you can see will appear here."
          />
        ) : (
          <div className="space-y-5">
            {days.map(({ day, entries }) => (
              <div key={day}>
                <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                  {dayLabel(day)}
                  {day === today && <ToneBadge label="Today" tone="info" />}
                  {day === tomorrow && <ToneBadge label="Tomorrow" tone="neutral" />}
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {entries.map((entry) => (
                    <EntryRow key={entry.key} entry={entry} when={entry.at ? formatManilaTime(entry.at) : "All day"} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** "Thursday, October 8" for a YYYY-MM-DD Manila date. */
function dayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return formatManila(manilaInstant(year, month - 1, date, 12 * 60), { weekday: "long", month: "long", day: "numeric" });
}

function EntryRow({ entry, when }: { entry: AgendaEntry; when: string }) {
  return (
    <li>
      <Link href={entry.href} className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
        <span className="w-24 shrink-0 pt-0.5 font-mono text-[12px] text-muted-foreground">{when}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{entry.title}</span>
          <span className="block text-[13px] text-muted-foreground">{entry.detail}</span>
        </span>
        {entry.badge && <ToneBadge label={entry.badge.label} tone={entry.badge.tone} />}
      </Link>
    </li>
  );
}
