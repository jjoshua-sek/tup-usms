import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { ApologyLetterPanel } from "@/components/violations/apology-letter-panel";
import { SignSettlementButton } from "@/components/violations/settlement-agreement";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import {
  appealWindow,
  resolveAppealRoute,
  type PenaltyBasis,
} from "@/lib/osa/sanctions";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaLongDate } from "@/lib/utils/time";
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

interface SettlementSummary {
  id: string;
  terms: string;
  student_obligations: string | null;
  compliance_deadline: string | null;
  student_signed_at: string | null;
  complainant_signed_at: string | null;
  osa_witnessed_at: string | null;
  is_complied: boolean | null;
}

interface ServiceSummary {
  id: string;
  offense_sequence: number;
  hours_required: number;
  hours_completed: number;
  deadline: string | null;
  service_detail: string | null;
  status: "assigned" | "in_progress" | "completed" | "not_served" | "waived";
}

interface AppealSummary {
  id: string;
  penalty_basis: string;
  appellate_body: string;
  notice_received_on: string;
  appeal_deadline: string;
  status: "window_open" | "filed" | "decided" | "lapsed" | "withdrawn";
  outcome: string | null;
  outcome_notes: string | null;
}

interface CaseWithApologies extends ViolationCaseWithRelations {
  apology_letters: ApologyLetterSummary[] | null;
  case_settlements: SettlementSummary[] | null;
  community_service_assignments: ServiceSummary[] | null;
  case_appeals: AppealSummary[] | null;
}

const SERVICE_STATUS: Record<ServiceSummary["status"], { label: string; tone: Tone }> = {
  assigned: { label: "Not started", tone: "warning" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  not_served: { label: "Not served", tone: "danger" },
  waived: { label: "Waived", tone: "neutral" },
};

/**
 * Plain-language reading of the committee stages. A student told their case
 * went "to the SDB" and nothing else has no idea whether to be worried or
 * what happens next — so the status says what the body is and what follows.
 */
const COMMITTEE_EXPLANATIONS: Partial<Record<string, string>> = {
  escalated_pic:
    "Your case is with the Preliminary Investigation Committee. They gather the facts and decide whether it goes to a formal hearing. You'll be notified if a hearing is scheduled, and you may bring someone with you.",
  escalated_sdb:
    "Your case is with the Student Disciplinary Board. They hold a formal hearing before deciding. You'll be summoned with a date, and you have the right to explain your side and to be accompanied.",
};

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
      "id, case_number, classification, status, incident_date, incident_location, description, sanction_applied, resolution_notes, created_at, closed_at, violation_types(code, name, handbook_reference, typical_sanction), apology_letters(id, review_status, submitted_at, reviewer_notes, file_path), case_settlements(id, terms, student_obligations, compliance_deadline, student_signed_at, complainant_signed_at, osa_witnessed_at, is_complied), community_service_assignments(id, offense_sequence, hours_required, hours_completed, deadline, service_detail, status), case_appeals(id, penalty_basis, appellate_body, notice_received_on, appeal_deadline, status, outcome, outcome_notes)",
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
                    {formatManilaLongDate(violationCase.incident_date)}
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

                {/* MINOR path, second offense onward: community service */}
                {(violationCase.community_service_assignments ?? []).map((service) => {
                  const meta = SERVICE_STATUS[service.status];
                  const remaining = Math.max(
                    service.hours_required - Number(service.hours_completed),
                    0,
                  );
                  const pct = Math.min(
                    Math.round((Number(service.hours_completed) / service.hours_required) * 100),
                    100,
                  );

                  return (
                    <div
                      key={service.id}
                      className="mt-4 rounded-lg border border-border bg-muted/40 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-semibold">Community service</p>
                        <ToneBadge label={meta.label} tone={meta.tone} />
                      </div>

                      <p className="mt-1.5 text-[13px]">
                        <strong>
                          {service.hours_completed} of {service.hours_required} hours
                        </strong>{" "}
                        recorded
                        {remaining > 0 && service.status !== "waived" && (
                          <span className="text-muted-foreground">
                            {" "}
                            &mdash; {remaining} to go
                          </span>
                        )}
                      </p>

                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border"
                        role="img"
                        aria-label={`${pct}% of the required hours recorded`}
                      >
                        <div
                          className="h-full rounded-full bg-tup-maroon-600"
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {service.service_detail && (
                        <p className="mt-2 text-[12px]">{service.service_detail}</p>
                      )}

                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {service.deadline
                          ? `Complete by ${formatManilaLongDate(service.deadline)}.`
                          : "No deadline set."}{" "}
                        Clearance and Good Moral requests are held until the hours are served.
                        Ask the office where you served to sign off, then the OSA records it.
                      </p>
                    </div>
                  );
                })}

                {/* After a sanction: the appeal window, which is the student's own deadline */}
                {(violationCase.case_appeals ?? []).map((appeal) => {
                  const window = appealWindow(appeal.notice_received_on);
                  const route = resolveAppealRoute(appeal.penalty_basis as PenaltyBasis);
                  const open = appeal.status === "window_open" && window.isOpen;

                  return (
                    <div
                      key={appeal.id}
                      className={`mt-4 rounded-lg border p-3 ${open ? "border-amber-200 bg-amber-50" : "border-border bg-muted/40"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={`text-[12px] font-semibold ${open ? "text-amber-900" : ""}`}
                        >
                          Your right to appeal
                        </p>
                        {open && (
                          <ToneBadge
                            label={
                              window.daysRemaining === 0
                                ? "Last day"
                                : `${window.daysRemaining} days left`
                            }
                            tone={window.daysRemaining <= 2 ? "danger" : "warning"}
                          />
                        )}
                      </div>

                      <p className={`mt-1.5 text-[12px] leading-relaxed ${open ? "text-amber-900" : ""}`}>
                        {open ? (
                          <>
                            You may appeal this decision to the{" "}
                            <strong>{route.bodyLabel}</strong> until{" "}
                            <strong>{formatManilaLongDate(appeal.appeal_deadline)}</strong> &mdash;{" "}
                            {route.days} days from when you received the Notice of Decision.
                            File it with that office; the OSA does not decide appeals.
                            {route.furtherRecourse ? ` ${route.furtherRecourse}` : ""}
                          </>
                        ) : appeal.status === "lapsed" ? (
                          <>
                            The appeal period closed on {formatManilaLongDate(appeal.appeal_deadline)}{" "}
                            without an appeal, so the decision stands.
                          </>
                        ) : appeal.outcome ? (
                          <>
                            Appeal <strong>{appeal.outcome}</strong> by the {route.bodyLabel}.
                            {appeal.outcome_notes ? ` ${appeal.outcome_notes}` : ""}
                          </>
                        ) : (
                          <>
                            Appeal filed with the {route.bodyLabel}. You will be told the
                            outcome.
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {route.handbookReference}
                      </p>
                    </div>
                  );
                })}

                {/* MAJOR path: mediated settlement awaiting the student's agreement */}
                {(violationCase.case_settlements ?? []).map((settlement) => {
                  const fullySigned =
                    settlement.student_signed_at &&
                    settlement.complainant_signed_at &&
                    settlement.osa_witnessed_at;

                  return (
                    <div
                      key={settlement.id}
                      className="mt-4 rounded-lg border border-border bg-muted/40 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-semibold">Settlement</p>
                        {settlement.is_complied ? (
                          <ToneBadge label="Completed" tone="success" />
                        ) : settlement.student_signed_at ? (
                          <ToneBadge
                            label={fullySigned ? "In effect" : "Waiting on the other parties"}
                            tone={fullySigned ? "success" : "info"}
                          />
                        ) : (
                          <ToneBadge label="Needs your agreement" tone="warning" />
                        )}
                      </div>

                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-background p-3 text-[12px] leading-relaxed">
                        {settlement.terms}
                      </p>

                      {settlement.student_obligations && (
                        <p className="mt-2 text-[12px]">
                          <strong>What you agreed to do:</strong>{" "}
                          {settlement.student_obligations}
                          {settlement.compliance_deadline && (
                            <span className="block text-[11px] text-muted-foreground">
                              Complete by{" "}
                              {formatManilaLongDate(settlement.compliance_deadline)}. The OSA closes the
                              case once you have.
                            </span>
                          )}
                        </p>
                      )}

                      {!settlement.student_signed_at && (
                        <div className="mt-3">
                          <SignSettlementButton settlementId={settlement.id} />
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Read the terms carefully. If you don&apos;t agree with them, talk
                            to the OSA before accepting — mediation can continue.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* MAJOR path: committee referral, explained */}
                {COMMITTEE_EXPLANATIONS[violationCase.status] && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
                    {COMMITTEE_EXPLANATIONS[violationCase.status]}
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
