import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarClock, MapPin, UserRound } from "lucide-react";

import { AcknowledgeButton } from "@/components/appointments/acknowledge-button";
import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { HEARING_STATUS_LABELS, type HearingStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "My Appointments",
};

const HEARING_TYPE_LABELS: Record<string, string> = {
  counselling: "Counselling session",
  conference: "Conference with the OSA",
  mediation: "Mediation",
  pic_hearing: "PIC hearing",
  sdb_hearing: "SDB hearing",
  follow_up: "Follow-up meeting",
};

const HEARING_TONE: Record<HearingStatus, Tone> = {
  awaiting_complainant: "neutral",
  complainant_approved: "info",
  student_notified: "warning",
  student_acknowledged: "info",
  confirmed: "success",
  completed: "neutral",
  rescheduled: "warning",
  cancelled: "neutral",
  no_show_student: "danger",
  no_show_complainant: "danger",
};

interface HearingRow {
  id: string;
  hearing_type: string;
  scheduled_start: string;
  scheduled_end: string;
  venue: string;
  status: HearingStatus;
  student_acknowledged_at: string | null;
  violation_cases: { case_number: string; student_id: string } | null;
}

interface GuidanceRow {
  id: string;
  session_type: string;
  scheduled_at: string | null;
  status: string;
}

function formatWhen(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = start.toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const time = (value: Date) =>
    value.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(start)} – ${time(end)}`;
}

/**
 * Everything the student is expected to turn up for (requirement #5).
 *
 * A hearing only becomes visible once the OSA has notified the student — the
 * RLS policy hides rows still sitting at `awaiting_complainant`, so a student
 * never sees a date the professor has not yet approved.
 */
export default async function AppointmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) redirect("/profile");

  const [{ data: hearingRows }, { data: guidanceRows }] = await Promise.all([
    db
      .from("case_hearings")
      .select(
        "id, hearing_type, scheduled_start, scheduled_end, venue, status, student_acknowledged_at, violation_cases!inner(case_number, student_id)",
      )
      .eq("violation_cases.student_id", student.id)
      .order("scheduled_start", { ascending: true }),
    db
      .from("guidance_sessions")
      .select("id, session_type, scheduled_at, status")
      .eq("student_id", student.id)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true }),
  ]);

  const hearings = (hearingRows as HearingRow[] | null) ?? [];
  const guidance = (guidanceRows as GuidanceRow[] | null) ?? [];

  const now = Date.now();
  const upcoming = hearings.filter(
    (hearing) =>
      new Date(hearing.scheduled_end).getTime() >= now &&
      !["cancelled", "completed"].includes(hearing.status),
  );
  const past = hearings.filter((hearing) => !upcoming.includes(hearing));

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "My Appointments" }]}
        title="My Appointments"
        description="Meetings the OSA has scheduled for you, and counselling sessions you've booked."
      />

      {upcoming.length === 0 && guidance.length === 0 && past.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No appointments scheduled"
          description="Nothing needs your attendance right now. If a meeting is scheduled, you'll be notified here and by email, and you'll be asked to confirm you've seen it."
        />
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
                Upcoming
              </h2>
              <ul className="space-y-3">
                {upcoming.map((hearing) => (
                  <li
                    key={hearing.id}
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display text-[15px] font-semibold">
                            {HEARING_TYPE_LABELS[hearing.hearing_type] ?? "Meeting"}
                          </p>
                          <ToneBadge
                            label={HEARING_STATUS_LABELS[hearing.status]}
                            tone={HEARING_TONE[hearing.status]}
                          />
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {hearing.violation_cases?.case_number}
                        </p>
                      </div>

                      {hearing.status === "student_notified" && (
                        <AcknowledgeButton hearingId={hearing.id} />
                      )}
                    </div>

                    <div className="mt-3 space-y-1 text-[13px]">
                      <p className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatWhen(hearing.scheduled_start, hearing.scheduled_end)}
                      </p>
                      <p className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {hearing.venue}
                      </p>
                    </div>

                    <p className="mt-3 rounded-lg bg-muted p-3 text-[12px] leading-relaxed">
                      Bring your validated TUP ID. If this time genuinely does not work,
                      reply through <strong>Concerns</strong> before the date — the OSA can
                      re-run the scheduler against your class schedule.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {guidance.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
                Guidance sessions
              </h2>
              <ul className="space-y-2">
                {guidance.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize">
                        {session.session_type.replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {session.scheduled_at
                          ? new Date(session.scheduled_at).toLocaleString("en-PH", {
                              month: "long",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "Time to be confirmed"}
                      </p>
                    </div>
                    <ToneBadge label="Scheduled" tone="info" />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                What you discuss with a counselor stays with the Guidance Office. Only the
                fact that a session happened is visible to other OSA staff.
              </p>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
                Past
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {past.map((hearing) => (
                  <li key={hearing.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {HEARING_TYPE_LABELS[hearing.hearing_type] ?? "Meeting"}
                        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                          {hearing.violation_cases?.case_number}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatWhen(hearing.scheduled_start, hearing.scheduled_end)}
                      </p>
                    </div>
                    <ToneBadge
                      label={HEARING_STATUS_LABELS[hearing.status]}
                      tone={HEARING_TONE[hearing.status]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
