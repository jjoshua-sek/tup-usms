import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { ApologyLetterPanel } from "@/components/violations/apology-letter-panel";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CASE_STATUS_META, type ViolationCaseWithRelations } from "@/types/osa";

export const metadata: Metadata = {
  title: "My Violations",
};

interface ApologyLetterSummary {
  id: string;
  review_status: "pending" | "accepted" | "revision_requested" | "rejected";
  submitted_at: string;
  reviewer_notes: string | null;
  file_path: string | null;
}

interface CaseWithApologies extends ViolationCaseWithRelations {
  apology_letters: ApologyLetterSummary[] | null;
}

/** What the student is told about each review outcome, and what to do next. */
const APOLOGY_META: Record<
  ApologyLetterSummary["review_status"],
  { label: string; tone: Tone; hint: string; canResubmit: boolean }
> = {
  pending: {
    label: "With the OSA",
    tone: "info",
    hint: "Your letter has been received and is waiting to be read.",
    canResubmit: false,
  },
  accepted: {
    label: "Accepted",
    tone: "success",
    hint: "Your letter was accepted. This case is settled on your side.",
    canResubmit: false,
  },
  revision_requested: {
    label: "Changes requested",
    tone: "warning",
    hint: "The OSA asked for a revised letter. Read their note, then send a new one.",
    canResubmit: true,
  },
  rejected: {
    label: "Not accepted",
    tone: "danger",
    hint: "The OSA did not accept this letter. Read their note and submit again.",
    canResubmit: true,
  },
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
      "id, case_number, classification, status, incident_date, incident_location, description, sanction_applied, resolution_notes, created_at, closed_at, violation_types(code, name, handbook_reference, typical_sanction), apology_letters(id, review_status, submitted_at, reviewer_notes, file_path)",
    )
    .eq("student_id", student.id)
    .order("incident_date", { ascending: false });

  const cases = (caseRows as CaseWithApologies[] | null) ?? [];

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

                {/* MINOR path close-out: the apology letter exchange */}
                {(() => {
                  const letters = [...(violationCase.apology_letters ?? [])].sort(
                    (a, b) =>
                      new Date(b.submitted_at).getTime() -
                      new Date(a.submitted_at).getTime(),
                  );
                  const latest = letters[0];
                  const awaiting = violationCase.status === "awaiting_apology";

                  if (!latest && !awaiting) return null;

                  const meta = latest ? APOLOGY_META[latest.review_status] : null;

                  return (
                    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-semibold">Apology letter</p>
                        {meta && <ToneBadge label={meta.label} tone={meta.tone} />}
                      </div>

                      {meta ? (
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          {meta.hint}
                        </p>
                      ) : (
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          This case closes once you send a written apology and the OSA
                          accepts it.
                        </p>
                      )}

                      {latest?.reviewer_notes && (
                        <p className="mt-2 rounded-md bg-background p-2 text-[12px]">
                          <strong>OSA note:</strong> {latest.reviewer_notes}
                        </p>
                      )}

                      {awaiting && (!latest || meta?.canResubmit) && (
                        <div className="mt-2">
                          <ApologyLetterPanel
                            caseId={violationCase.id}
                            caseNumber={violationCase.case_number}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

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
