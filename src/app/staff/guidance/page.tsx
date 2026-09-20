import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, HeartPulse, Lock, NotebookPen } from "lucide-react";

import { LogSessionForm } from "@/components/guidance/log-session-form";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Guidance",
};

export const revalidate = 30;

const STATUS_TONE: Record<string, Tone> = {
  scheduled: "info",
  completed: "success",
  no_show: "warning",
  cancelled: "neutral",
  rescheduled: "warning",
};

interface SessionRow {
  id: string;
  session_type: string;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  presenting_concern: string | null;
  concern_category: string | null;
  summary: string | null;
  follow_up_required: boolean;
  follow_up_date: string | null;
  confidentiality: string;
  counselor_id: string;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
  } | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Guidance sessions.
 *
 * Note what this page does NOT select: `confidential_notes`. RLS would hand
 * the column over to the counselor who wrote it, but leaving it out of the
 * query entirely means a future change to this page can't accidentally
 * render someone's counselling notes into a shared screen.
 */
export default async function StaffGuidancePage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isCounselor && !staff.isOsa)) {
    return (
      <RestrictedNotice
        title="Guidance"
        audience="Guidance records are limited to counselors and the OSA leadership."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("guidance_sessions")
    .select(
      "id, session_type, status, scheduled_at, started_at, presenting_concern, concern_category, summary, follow_up_required, follow_up_date, confidentiality, counselor_id, students(id, first_name, last_name, student_number)",
    )
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(200);

  const sessions = (rows as SessionRow[] | null) ?? [];
  const upcoming = sessions.filter((session) => session.status === "scheduled");
  const followUps = sessions.filter(
    (session) => session.follow_up_required && session.status === "completed",
  );

  const canLog = staff.isCounselor || staff.role === "osa_head" || staff.isAdmin;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Guidance" }]}
        title="Guidance"
        description="Counselling sessions, with notes kept where they belong."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard label="Sessions logged" value={sessions.length} icon={NotebookPen} />
        <StatsCard label="Scheduled" value={upcoming.length} icon={CalendarClock} />
        <StatsCard
          label="Follow-ups due"
          value={followUps.length}
          icon={HeartPulse}
          iconTone={followUps.length > 0 ? "warn" : "neutral"}
        />
      </div>

      {canLog && (
        <div className="mb-6">
          <LogSessionForm />
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No sessions recorded"
          description="Log a walk-in or a scheduled session. Only the summary is shared; confidential notes stay with the counselor who wrote them."
        />
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold capitalize">
                      {session.session_type.replace(/_/g, " ")}
                    </p>
                    <ToneBadge
                      label={session.status.replace(/_/g, " ")}
                      tone={STATUS_TONE[session.status] ?? "neutral"}
                    />
                    {session.confidentiality === "counselor_only" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        counselor-only notes
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[13px]">
                    {session.students ? (
                      <Link
                        href={`/staff/students/${session.students.id}`}
                        className="text-tup-maroon-600 underline-offset-2 hover:underline"
                      >
                        {session.students.first_name} {session.students.last_name}
                      </Link>
                    ) : (
                      "Unknown student"
                    )}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {session.students?.student_number}
                    </span>
                  </p>

                  {session.presenting_concern && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {session.presenting_concern}
                      {session.concern_category ? ` · ${session.concern_category}` : ""}
                    </p>
                  )}

                  {session.summary && (
                    <p className="mt-1.5 rounded-md bg-muted p-2 text-[12px]">
                      {session.summary}
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <p>{formatDate(session.started_at ?? session.scheduled_at)}</p>
                  {session.follow_up_required && (
                    <p className="mt-0.5 text-amber-700">
                      Follow up {formatDate(session.follow_up_date)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
        Sessions marked counselor-only are readable by the counselor who wrote them and no
        one else — not the OSA head, not administrators. Discipline staff see that a session
        took place, never what was said.
      </p>
    </div>
  );
}
