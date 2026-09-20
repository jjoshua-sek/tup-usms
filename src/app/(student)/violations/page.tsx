import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CASE_STATUS_META, type ViolationCaseWithRelations } from "@/types/osa";

export const metadata: Metadata = {
  title: "My Violations",
};

const CLASSIFICATION_META = {
  minor: { label: "Minor", tone: "warning" as const },
  major: { label: "Major", tone: "danger" as const },
  confidential: { label: "Confidential", tone: "danger" as const },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The student's own disciplinary record (requirement #5).
 *
 * Confidential (CODI) matters never appear here: the RLS policy in 00013
 * restricts `violation_cases` reads to non-confidential rows, which is the
 * same rule the OSA process document applies to paper files.
 */
export default async function ViolationsPage() {
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

  const { data: caseRows } = await db
    .from("violation_cases")
    .select(
      "id, case_number, classification, status, incident_date, incident_location, description, sanction_applied, resolution_notes, created_at, closed_at, violation_types(code, name, handbook_reference, typical_sanction)",
    )
    .eq("student_id", student.id)
    .order("incident_date", { ascending: false });

  const cases = (caseRows as ViolationCaseWithRelations[] | null) ?? [];

  const minorCount = cases.filter((c) => c.classification === "minor").length;
  const majorCount = cases.filter((c) => c.classification === "major").length;
  const openCount = cases.filter(
    (c) => !CASE_STATUS_META[c.status]?.isTerminal,
  ).length;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "My Violations" }]}
        title="My Violations"
        description="Your disciplinary record with the Office of Student Affairs, and where each case stands."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard label="Minor offenses" value={minorCount} icon={ShieldCheck} />
        <StatsCard
          label="Major offenses"
          value={majorCount}
          icon={ShieldCheck}
          iconTone={majorCount > 0 ? "danger" : "neutral"}
        />
        <StatsCard
          label="Still open"
          value={openCount}
          icon={CalendarDays}
          iconTone={openCount > 0 ? "warn" : "neutral"}
          trend={openCount > 0 ? "Open cases can hold up clearance" : "Nothing pending"}
          trendTone={openCount > 0 ? "warn" : "neutral"}
        />
      </div>

      {cases.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No violations on record"
          description="Your record with the OSA is clean. If a case is ever filed against you, it appears here along with the schedule of any meeting you need to attend."
        />
      ) : (
        <ul className="space-y-3">
          {cases.map((violationCase) => {
            const statusMeta = CASE_STATUS_META[violationCase.status];
            const classification = CLASSIFICATION_META[violationCase.classification];

            return (
              <li
                key={violationCase.id}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {violationCase.case_number}
                      </span>
                      <ToneBadge label={classification.label} tone={classification.tone} />
                      <ToneBadge
                        label={statusMeta?.label ?? violationCase.status}
                        tone={statusMeta?.tone ?? "neutral"}
                      />
                    </div>
                    <p className="mt-1.5 font-display text-[15px] font-semibold">
                      {violationCase.violation_types?.name ?? "Violation"}
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {violationCase.description}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {formatDate(violationCase.incident_date)}
                  </span>
                  {violationCase.incident_location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {violationCase.incident_location}
                    </span>
                  )}
                </div>

                {violationCase.sanction_applied && (
                  <p className="mt-3 rounded-lg bg-muted p-3 text-[12px]">
                    <strong>Sanction:</strong> {violationCase.sanction_applied}
                  </p>
                )}

                {!statusMeta?.isTerminal && (
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    Check <strong className="text-foreground">My Appointments</strong> for any
                    meeting scheduled for this case.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
