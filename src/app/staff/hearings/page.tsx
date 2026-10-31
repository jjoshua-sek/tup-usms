import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, CalendarDotsIcon as CalendarClock, ChecksIcon as CheckCheck, MapPinIcon as MapPin } from "@phosphor-icons/react/ssr";

import { HearingActions } from "@/components/cases/case-workflow";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getStaffContext } from "@/lib/osa/staff-context";
import { WAITING } from "@/lib/osa/today";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManilaDateTime, formatManilaTime, manilaDayLabel, nowMs } from "@/lib/utils/time";
import { HEARING_STATUS_LABELS, HEARING_TYPE_LABELS, type HearingStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "Hearings",
};

export const revalidate = 15;

const HEARING_TONE: Record<HearingStatus, Tone> = {
  awaiting_complainant: "warning",
  complainant_approved: "info",
  student_notified: "info",
  student_acknowledged: "success",
  confirmed: "success",
  completed: "neutral",
  rescheduled: "warning",
  cancelled: "neutral",
  no_show_student: "danger",
  no_show_complainant: "danger",
};

/** How many earlier meetings the folded list at the bottom shows. */
const EARLIER_SHOWN = 30;

const COLUMNS =
  "id, case_id, hearing_type, scheduled_start, scheduled_end, venue, status, student_acknowledged_at, violation_cases(case_number, complainant_staff_id, complainant_name, students(first_name, last_name, student_number))";

interface HearingRow {
  id: string;
  case_id: string;
  hearing_type: string;
  scheduled_start: string;
  scheduled_end: string;
  venue: string;
  status: HearingStatus;
  student_acknowledged_at: string | null;
  violation_cases: {
    case_number: string;
    complainant_staff_id: string | null;
    complainant_name: string | null;
    students: { first_name: string; last_name: string; student_number: string } | null;
  } | null;
}

/**
 * Every scheduled meeting in one queue, ordered by what is blocking it.
 *
 * The two action states matter most: dates a professor still has to approve,
 * and approved dates the student hasn't been told about yet. Both are places
 * where a case quietly stalls if nobody is looking. Then the meetings ahead,
 * by day, and the earlier ones folded away at the bottom.
 */
export default async function StaffHearingsPage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCommittee && staff.role !== "faculty")) {
    return (
      <RestrictedNotice
        title="Hearings"
        audience="Hearing schedules are visible to OSA officers, committee members and complainant faculty."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);
  const now = new Date(nowMs());

  // Two reads, so the current list never loses rows to a cap filled by old
  // meetings: everything still waiting or still ahead, then the most recent
  // of the rest.
  const [{ data: currentRows }, { data: earlierRows }] = await Promise.all([
    db
      .from("case_hearings")
      .select(COLUMNS)
      .or(`status.in.(awaiting_complainant,complainant_approved),scheduled_end.gte.${now.toISOString()}`)
      .order("scheduled_start", { ascending: true })
      .limit(200),
    db
      .from("case_hearings")
      .select(COLUMNS)
      .not("status", "in", "(awaiting_complainant,complainant_approved)")
      .lt("scheduled_end", now.toISOString())
      .order("scheduled_start", { ascending: false })
      .limit(EARLIER_SHOWN),
  ]);

  const current = (currentRows as HearingRow[] | null) ?? [];
  const earlier = (earlierRows as HearingRow[] | null) ?? [];

  const awaitingApproval = current.filter((h) => h.status === "awaiting_complainant");
  const awaitingNotice = current.filter((h) => h.status === "complainant_approved");
  const upcoming = current.filter((h) => (WAITING.hearingsGoingAhead as readonly string[]).includes(h.status));
  const unconfirmed = upcoming.filter((h) => h.status === "student_notified").length;

  // The meetings ahead, one heading per day.
  const byDay = new Map<string, HearingRow[]>();
  for (const hearing of upcoming) {
    const day = manilaDayLabel(hearing.scheduled_start, now);
    byDay.set(day, [...(byDay.get(day) ?? []), hearing]);
  }

  const rowProps = { staffId: staff.staffId, isOsa: staff.isOsa };
  const nothingCurrent = awaitingApproval.length + awaitingNotice.length + upcoming.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Hearings" }]}
        title="Hearings"
        description="Meetings the OSA has set with students. Dates that need someone's approval come first, then the meetings ahead, by day."
      />

      {nothingCurrent ? (
        <EmptyState
          icon={CalendarClock}
          title="No meetings coming up"
          description="Open a case, find meeting times that fit both parties' schedules, and set one. The summons goes out with it, or once a faculty complainant approves the date."
        />
      ) : (
        <>
          {awaitingApproval.length > 0 && (
            <Group
              title="Waiting for the complainant to approve the date"
              note="The student is summoned as soon as the date is approved."
              count={awaitingApproval.length}
            >
              {awaitingApproval.map((hearing) => (
                <HearingItem key={hearing.id} hearing={hearing} withDay {...rowProps} />
              ))}
            </Group>
          )}

          {awaitingNotice.length > 0 && (
            <Group
              title="Approved, but the student has not been told yet"
              note="Press Notify the student to send the summons."
              count={awaitingNotice.length}
            >
              {awaitingNotice.map((hearing) => (
                <HearingItem key={hearing.id} hearing={hearing} withDay {...rowProps} />
              ))}
            </Group>
          )}

          {upcoming.length > 0 && (
            <Group
              title="Coming up"
              note={
                unconfirmed > 0
                  ? `${unconfirmed} of these ${unconfirmed === 1 ? "has" : "have"} not been confirmed by the student yet.`
                  : "Every student has confirmed their summons."
              }
              count={upcoming.length}
            >
              {[...byDay.entries()].map(([day, hearings]) => (
                <li key={day} className="space-y-2">
                  <h3 className="pt-2 text-base font-semibold text-tup-maroon-700">{day}</h3>
                  <ul className="space-y-2">
                    {hearings.map((hearing) => (
                      <HearingItem key={hearing.id} hearing={hearing} {...rowProps} />
                    ))}
                  </ul>
                </li>
              ))}
            </Group>
          )}
        </>
      )}

      {earlier.length > 0 && (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            Earlier meetings
            <span className="font-normal text-muted-foreground">
              ({earlier.length === EARLIER_SHOWN ? `the last ${EARLIER_SHOWN}` : earlier.length})
            </span>
          </summary>
          <ul className="space-y-2 border-t border-border p-4">
            {earlier.map((hearing) => (
              <HearingItem key={hearing.id} hearing={hearing} withDay {...rowProps} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({
  title,
  note,
  count,
  children,
}: {
  title: string;
  note: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
          {count}
        </span>
      </h2>
      <p className="mb-3 mt-0.5 text-base text-muted-foreground">{note}</p>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function HearingItem({
  hearing,
  withDay = false,
  staffId,
  isOsa,
}: {
  hearing: HearingRow;
  /** Show the date as well as the time, for lists not already grouped by day. */
  withDay?: boolean;
  staffId: string;
  isOsa: boolean;
}) {
  const kase = hearing.violation_cases;
  const student = kase?.students;
  // The status says "Student acknowledged" already; the tick is for the others.
  const showAcknowledged = hearing.student_acknowledged_at && hearing.status !== "student_acknowledged";

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-lg font-semibold">
            {withDay ? formatManilaDateTime(hearing.scheduled_start) : formatManilaTime(hearing.scheduled_start)}
          </span>
          <ToneBadge label={HEARING_STATUS_LABELS[hearing.status]} tone={HEARING_TONE[hearing.status]} />
          {showAcknowledged && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-700">
              <CheckCheck className="h-4 w-4" />
              Student confirmed
            </span>
          )}
        </p>

        <p className="text-base">
          <span className="font-medium">
            {student ? `${student.first_name} ${student.last_name}` : "Unknown student"}
          </span>
          {student?.student_number && (
            <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">{student.student_number}</span>
          )}
        </p>

        <p className="text-base text-muted-foreground">
          {HEARING_TYPE_LABELS[hearing.hearing_type] ?? hearing.hearing_type}
          <span className="whitespace-nowrap">
            <MapPin className="ml-3 mr-1 inline h-4 w-4" />
            {hearing.venue}
          </span>
          {kase?.complainant_name ? ` · Complainant: ${kase.complainant_name}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HearingActions
          hearingId={hearing.id}
          status={hearing.status}
          canApprove={kase?.complainant_staff_id === staffId || isOsa}
          canNotify={isOsa}
        />
        <Link href={`/staff/cases/${hearing.case_id}`} className={cn(buttonVariants({ variant: "outline" }))}>
          Open case
          {kase?.case_number && (
            <span className="ml-1.5 whitespace-nowrap font-mono text-sm text-muted-foreground">{kase.case_number}</span>
          )}
        </Link>
      </div>
    </li>
  );
}
