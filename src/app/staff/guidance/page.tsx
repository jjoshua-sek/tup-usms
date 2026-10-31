import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, LockIcon as Lock, NotePencilIcon as NotebookPen } from "@phosphor-icons/react/ssr";

import { LogSessionForm } from "@/components/guidance/log-session-form";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { SESSION_CATEGORY_LABELS, SESSION_STATUS_LABELS, SESSION_TYPE_LABELS } from "@/lib/osa/guidance-labels";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaDate } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Guidance sessions",
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
        title="Guidance sessions"
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
  const shown = new Set([...upcoming, ...followUps].map((session) => session.id));
  const earlier = sessions.filter((session) => !shown.has(session.id));

  const canLog = staff.isCounselor || staff.role === "osa_head" || staff.isAdmin;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Guidance sessions" }]}
        title="Guidance sessions"
        description="Counselling sessions with students. Only the summary is shared; confidential notes stay with the counselor who wrote them."
      />

      {canLog && <LogSessionForm />}

      {sessions.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No sessions recorded"
          description="Log a walk-in or a scheduled session. Only the summary is shared; confidential notes stay with the counselor who wrote them."
        />
      ) : (
        <>
          {upcoming.length > 0 && <Group title="Coming up" sessions={upcoming} />}
          {followUps.length > 0 && (
            <Group title="Follow-ups due" note="Sessions that asked for another meeting." sessions={followUps} />
          )}
          {earlier.length > 0 && (
            <details className="group rounded-xl border border-border bg-card" open={upcoming.length + followUps.length === 0}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                Earlier sessions
                <span className="rounded-full bg-muted px-2 font-normal tabular-nums text-muted-foreground">{earlier.length}</span>
              </summary>
              <ul className="space-y-2 border-t border-border p-4">
                {earlier.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <p className="max-w-prose rounded-xl border border-border bg-muted/40 p-4 text-base leading-relaxed text-muted-foreground">
        Confidential notes are readable by the counselor who wrote them and no one else: not the OSA head, not
        administrators. Discipline staff see that a session took place, never what was said.
      </p>
    </div>
  );
}

function Group({ title, note, sessions }: { title: string; note?: string; sessions: SessionRow[] }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
          {sessions.length}
        </span>
      </h2>
      {note && <p className="mt-0.5 text-base text-muted-foreground">{note}</p>}
      <ul className="mt-3 space-y-2">
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} />
        ))}
      </ul>
    </section>
  );
}

function SessionItem({ session }: { session: SessionRow }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-base">
            {session.students ? (
              <Link
                href={`/staff/students/${session.students.id}`}
                className="text-lg font-semibold text-tup-maroon-700 underline-offset-2 hover:underline"
              >
                {session.students.first_name} {session.students.last_name}
              </Link>
            ) : (
              <span className="text-lg font-semibold">Unknown student</span>
            )}
            {session.students?.student_number && (
              <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
                {session.students.student_number}
              </span>
            )}
          </p>

          <p className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">
              {SESSION_TYPE_LABELS[session.session_type] ?? session.session_type}
            </span>
            <ToneBadge
              label={SESSION_STATUS_LABELS[session.status] ?? session.status}
              tone={STATUS_TONE[session.status] ?? "neutral"}
            />
            {session.confidentiality === "counselor_only" && (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                Has confidential notes
              </span>
            )}
          </p>

          {session.presenting_concern && (
            <p className="text-base text-muted-foreground">
              {session.presenting_concern}
              {session.concern_category
                ? ` · ${SESSION_CATEGORY_LABELS[session.concern_category] ?? session.concern_category}`
                : ""}
            </p>
          )}

          {session.summary && <p className="mt-1.5 max-w-prose rounded-md bg-muted p-2 text-base">{session.summary}</p>}
        </div>

        <div className="shrink-0 text-right text-base text-muted-foreground">
          <p>{formatManilaDate(session.started_at ?? session.scheduled_at)}</p>
          {session.follow_up_required && (
            <p className="mt-0.5 text-amber-800">Follow up by {formatManilaDate(session.follow_up_date)}</p>
          )}
        </div>
      </div>
    </li>
  );
}
