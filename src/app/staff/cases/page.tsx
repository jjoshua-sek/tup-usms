import type { Metadata } from "next";
import Link from "next/link";

import { CaretRightIcon as ChevronRight, PlusIcon as Plus, ScalesIcon as Scale } from "@phosphor-icons/react/ssr";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { isClassificationPending } from "@/lib/osa/classification";
import { getStaffContext } from "@/lib/osa/staff-context";
import { WAITING } from "@/lib/osa/today";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManilaDate } from "@/lib/utils/time";
import { CASE_STATUS_META, type ViolationCaseWithRelations } from "@/types/osa";

export const metadata: Metadata = {
  title: "Discipline cases",
};

export const revalidate = 15;

const CLASSIFICATION = {
  minor: { label: "Minor", tone: "warning" as const },
  major: { label: "Major", tone: "danger" as const },
  confidential: { label: "Confidential", tone: "danger" as const },
};

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "scheduling", label: "Needs a date" },
  { key: "apology", label: "Apology letters" },
  { key: "escalated", label: "Escalated" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

interface CaseRow extends ViolationCaseWithRelations {
  apology_letters: Array<{ review_status: string }> | null;
  /** Migration 00049: an offense outside the Student Manual the OSA has not classified yet. */
  classification_pending?: boolean;
}

/** A letter sitting unread is work for the OSA, not for the student. */
function hasPendingLetter(row: CaseRow): boolean {
  return (row.apology_letters ?? []).some((letter) => letter.review_status === "pending");
}

// Shared with the home page's "Today" list, so both count the same cases.
const SCHEDULING_STATUSES: readonly string[] = WAITING.casesToSchedule;
const ESCALATED_STATUSES = ["escalated_pic", "escalated_sdb", "referred_codi"];

/**
 * The OSA case queue (requirement #4).
 *
 * Confidential CODI matters are filtered by RLS, not by this page: a staff
 * member without `can_access_confidential` simply never receives those rows,
 * so there is no "hidden row" for the UI to accidentally leak in a count.
 */
export default async function StaffCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCommittee)) {
    return (
      <RestrictedNotice
        title="Discipline cases"
        audience="The case queue is for OSA officers and committee members (PIC, SDB, CODI). Any staff member can still file a complaint against a student."
      >
        {/* Checklist A3: students and any staff may file, against students only. */}
        {staff && (
          <Link
            href="/staff/cases/new"
            className={cn(buttonVariants(), "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            File a complaint
          </Link>
        )}
      </RestrictedNotice>
    );
  }

  const { filter } = await searchParams;
  const activeFilter: FilterKey = FILTERS.find((f) => f.key === filter)?.key ?? "open";

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("violation_cases")
    .select(
      // "*" so classification_pending (00049) is read once it exists.
      "*, students(first_name, last_name, student_number, program), violation_types(code, name), apology_letters(review_status)",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const cases = (rows as CaseRow[] | null) ?? [];

  const open = cases.filter((c) => !CASE_STATUS_META[c.status]?.isTerminal);
  const needsScheduling = open.filter((c) => SCHEDULING_STATUSES.includes(c.status));
  const escalated = open.filter((c) => ESCALATED_STATUSES.includes(c.status));
  // Letters to read first, then cases still waiting on the student.
  const apologyWork = cases
    .filter((c) => hasPendingLetter(c) || c.status === "awaiting_apology")
    .sort((a, b) => Number(hasPendingLetter(b)) - Number(hasPendingLetter(a)));

  const byFilter: Record<FilterKey, CaseRow[]> = {
    open,
    scheduling: needsScheduling,
    apology: apologyWork,
    escalated,
    all: cases,
  };
  const visible = byFilter[activeFilter];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Discipline cases" }]}
        title="Discipline cases"
        description="Every case filed with the OSA, and where each one stands. Open a case to schedule it, record what happened, or close it."
      >
        <Link
          href="/staff/cases/new"
          className={cn(buttonVariants(), "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          File a case
        </Link>
      </PageHeader>

      {/* The tabs carry their own counts, so no separate number tiles. */}
      <nav aria-label="Which cases" className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {FILTERS.map((option) => {
          const active = activeFilter === option.key;
          return (
            <Link
              key={option.key}
              href={`/staff/cases?filter=${option.key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-base font-medium transition-colors",
                active
                  ? "border-tup-maroon-600 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
              <span
                className={cn(
                  "rounded-full px-2 text-sm tabular-nums",
                  active ? "bg-tup-maroon-600 text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {byFilter[option.key].length}
              </span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No cases in this view"
          description="Cases are filed by faculty and staff. When one is filed, it lands here for classification and scheduling."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((violationCase) => {
            const statusMeta = CASE_STATUS_META[violationCase.status];
            const student = violationCase.students;
            const classification = CLASSIFICATION[violationCase.classification];
            return (
              <li key={violationCase.id}>
                {/* The whole row opens the case, not only its number. */}
                <Link
                  href={`/staff/cases/${violationCase.id}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-base">
                        <span className="text-lg font-semibold">
                          {student ? `${student.first_name} ${student.last_name}` : "Unknown student"}
                        </span>
                        {student?.student_number && (
                          <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
                            {student.student_number}
                          </span>
                        )}
                      </p>
                      <ToneBadge label={statusMeta?.label ?? violationCase.status} tone={statusMeta?.tone ?? "neutral"} />
                    </div>
                    <p className="text-base">{violationCase.violation_types?.name ?? "Offense not yet classified"}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                      <span className="whitespace-nowrap font-mono">{violationCase.case_number}</span>
                      {isClassificationPending(violationCase) ? (
                        <ToneBadge label="To classify" tone="info" />
                      ) : (
                        classification && <ToneBadge label={classification.label} tone={classification.tone} />
                      )}
                      <span className="whitespace-nowrap">Incident {formatManilaDate(violationCase.incident_date)}</span>
                      {hasPendingLetter(violationCase) && <ToneBadge label="Letter to review" tone="warning" />}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
