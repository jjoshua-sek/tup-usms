import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCheck, Gavel, MapPin, Send } from "lucide-react";

import { HearingActions } from "@/components/cases/case-workflow";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { isUpcoming } from "@/lib/utils/time";
import { HEARING_STATUS_LABELS, type HearingStatus } from "@/types/osa";

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

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Every scheduled meeting in one queue, ordered by what is blocking it.
 *
 * The two action states matter most: dates a professor still has to approve,
 * and approved dates the student hasn't been told about yet. Both are places
 * where a case quietly stalls if nobody is looking.
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

  const { data: rows } = await db
    .from("case_hearings")
    .select(
      "id, case_id, hearing_type, scheduled_start, scheduled_end, venue, status, student_acknowledged_at, violation_cases(case_number, complainant_staff_id, complainant_name, students(first_name, last_name, student_number))",
    )
    .order("scheduled_start", { ascending: true })
    .limit(200);

  const hearings = (rows as HearingRow[] | null) ?? [];

  const awaitingApproval = hearings.filter((h) => h.status === "awaiting_complainant");
  const awaitingNotice = hearings.filter((h) => h.status === "complainant_approved");
  const upcoming = hearings.filter(
    (h) =>
      isUpcoming(h.scheduled_end) &&
      ["student_notified", "student_acknowledged", "confirmed"].includes(h.status),
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Hearings" }]}
        title="Hearings"
        description="Meeting dates waiting on an approval, a summons, or the day itself."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard
          label="Awaiting complainant"
          value={awaitingApproval.length}
          icon={Gavel}
          iconTone={awaitingApproval.length > 0 ? "warn" : "neutral"}
          trend="Professor must approve the date"
        />
        <StatsCard
          label="Ready to notify"
          value={awaitingNotice.length}
          icon={Send}
          iconTone={awaitingNotice.length > 0 ? "warn" : "neutral"}
          trend="Approved but no summons sent"
        />
        <StatsCard
          label="Upcoming"
          value={upcoming.length}
          icon={CalendarClock}
          iconTone="success"
        />
      </div>

      {hearings.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No hearings scheduled"
          description="Open a case and run the scheduler to propose a meeting time that fits both the complainant's and the student's schedules."
        />
      ) : (
        <div className="space-y-8">
          <Group
            title="Waiting for the complainant to approve"
            hearings={awaitingApproval}
            staffId={staff.staffId}
            isOsa={staff.isOsa}
          />
          <Group
            title="Approved — summons not sent"
            hearings={awaitingNotice}
            staffId={staff.staffId}
            isOsa={staff.isOsa}
          />
          <Group
            title="Upcoming"
            hearings={upcoming}
            staffId={staff.staffId}
            isOsa={staff.isOsa}
          />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  hearings,
  staffId,
  isOsa,
}: {
  title: string;
  hearings: HearingRow[];
  staffId: string;
  isOsa: boolean;
}) {
  if (hearings.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {hearings.length}
        </span>
      </h2>
      <ul className="space-y-2">
        {hearings.map((hearing) => (
          <li
            key={hearing.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/staff/cases/${hearing.case_id}`}
                  className="font-mono text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
                >
                  {hearing.violation_cases?.case_number}
                </Link>
                <ToneBadge
                  label={HEARING_STATUS_LABELS[hearing.status]}
                  tone={HEARING_TONE[hearing.status]}
                />
                {hearing.student_acknowledged_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                    <CheckCheck className="h-3 w-3" />
                    acknowledged
                  </span>
                )}
              </div>

              <p className="mt-1 text-[13px] font-medium">
                {hearing.violation_cases?.students
                  ? `${hearing.violation_cases.students.first_name} ${hearing.violation_cases.students.last_name}`
                  : "Unknown student"}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {hearing.violation_cases?.students?.student_number}
                </span>
              </p>

              <p className="mt-0.5 text-[12px] text-muted-foreground">
                <CalendarClock className="mr-1 inline h-3 w-3" />
                {formatWhen(hearing.scheduled_start)}
                <MapPin className="ml-3 mr-1 inline h-3 w-3" />
                {hearing.venue}
                {hearing.violation_cases?.complainant_name
                  ? ` · complainant: ${hearing.violation_cases.complainant_name}`
                  : ""}
              </p>
            </div>

            <HearingActions
              hearingId={hearing.id}
              status={hearing.status}
              canApprove={
                hearing.violation_cases?.complainant_staff_id === staffId || isOsa
              }
              canNotify={isOsa}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
