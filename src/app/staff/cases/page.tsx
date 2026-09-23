import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FolderOpen, Gavel, Plus, Scale } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { buttonVariants } from "@/components/ui/button";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManilaDate } from "@/lib/utils/time";
import { CASE_STATUS_META, type ViolationCaseWithRelations } from "@/types/osa";

export const metadata: Metadata = {
  title: "Cases",
};

export const revalidate = 15;

const CLASSIFICATION_TONE = {
  minor: "warning" as const,
  major: "danger" as const,
  confidential: "danger" as const,
};

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "scheduling", label: "Needs scheduling" },
  { key: "apology", label: "Apology letters" },
  { key: "escalated", label: "Escalated" },
  { key: "all", label: "All" },
] as const;

interface CaseRow extends ViolationCaseWithRelations {
  apology_letters: Array<{ review_status: string }> | null;
}

/** A letter sitting unread is work for the OSA, not for the student. */
function hasPendingLetter(row: CaseRow): boolean {
  return (row.apology_letters ?? []).some((letter) => letter.review_status === "pending");
}

const SCHEDULING_STATUSES = ["filed", "under_review", "counselling_scheduled"];
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
        title="Cases"
        audience="The case queue is for OSA officers and committee members (PIC, SDB, CODI)."
      />
    );
  }

  const { filter } = await searchParams;
  const activeFilter = FILTERS.some((f) => f.key === filter) ? filter! : "open";

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("violation_cases")
    .select(
      "id, case_number, classification, status, incident_date, created_at, confidentiality, students(first_name, last_name, student_number, program), violation_types(code, name), apology_letters(review_status)",
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

  const visible =
    activeFilter === "all"
      ? cases
      : activeFilter === "scheduling"
        ? needsScheduling
        : activeFilter === "escalated"
          ? escalated
          : activeFilter === "apology"
            ? apologyWork
            : open;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Cases" }]}
        title="Discipline Cases"
        description="Every case filed with the OSA, and where each one stands in the process."
      >
        <Link
          href="/staff/cases/new"
          className={buttonVariants({ size: "sm", className: "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700" })}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          File a case
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Open cases" value={open.length} icon={FolderOpen} />
        <StatsCard
          label="Needs scheduling"
          value={needsScheduling.length}
          icon={Gavel}
          iconTone={needsScheduling.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard
          label="Escalated"
          value={escalated.length}
          icon={AlertTriangle}
          iconTone={escalated.length > 0 ? "danger" : "neutral"}
        />
        <StatsCard label="All time" value={cases.length} icon={Scale} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/staff/cases?filter=${option.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              activeFilter === option.key
                ? "border-tup-maroon-600 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No cases in this view"
          description="Cases are filed by faculty and staff. When one is filed, it lands here for classification and scheduling."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Case</th>
                <th className="px-4 py-2.5 font-medium">Student</th>
                <th className="px-4 py-2.5 font-medium">Offense</th>
                <th className="px-4 py-2.5 font-medium">Incident</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((violationCase) => {
                const statusMeta = CASE_STATUS_META[violationCase.status];
                return (
                  <tr key={violationCase.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/staff/cases/${violationCase.id}`}
                        className="font-mono text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
                      >
                        {violationCase.case_number}
                      </Link>
                      <div className="mt-0.5">
                        <ToneBadge
                          label={violationCase.classification}
                          tone={CLASSIFICATION_TONE[violationCase.classification]}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">
                        {violationCase.students
                          ? `${violationCase.students.first_name} ${violationCase.students.last_name}`
                          : "—"}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {violationCase.students?.student_number ?? ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {violationCase.violation_types?.name ?? "Unclassified"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatManilaDate(violationCase.incident_date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <ToneBadge
                        label={statusMeta?.label ?? violationCase.status}
                        tone={statusMeta?.tone ?? "neutral"}
                      />
                      {hasPendingLetter(violationCase) && (
                        <div className="mt-1">
                          <ToneBadge label="Letter to review" tone="warning" />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
