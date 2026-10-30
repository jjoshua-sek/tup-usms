import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, ArrowUpRightIcon as ArrowUpRight, CaretDownIcon as ChevronDown, CalendarDotsIcon as CalendarClock, CalendarDotIcon as CalendarSearch, HandshakeIcon as Handshake, HardHatIcon as HardHat, ClockCounterClockwiseIcon as History, EnvelopeSimpleIcon as Mail, MapPinIcon as MapPin, ScalesIcon as Scale, UserIcon as User } from "@phosphor-icons/react/ssr";

import {
  ApologyFileLink,
  ApologyReviewControls,
} from "@/components/cases/apology-review";
import {
  EscalateForm,
  EscalationOutcomeForm,
} from "@/components/cases/escalation-panel";
import {
  AppealOutcomeForm,
  AppealWindowForm,
  CommunityServiceForm,
  ManualHearingForm,
  NonAppearanceForm,
  ServiceProgressForm,
} from "@/components/cases/sanction-panel";
import {
  ComplianceForm,
  DraftSettlementForm,
  SettlementSignature,
} from "@/components/cases/settlement-panel";
import {
  CaseStatusForm,
  HearingActions,
  ProposalPicker,
  ProposeSlotsButton,
  type ProposalView,
} from "@/components/cases/case-workflow";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { caseNextStep, type CaseSection } from "@/lib/osa/case-next-step";
import { cn } from "@/lib/utils";
import {
  appealWindow,
  inferPenaltyBasis,
  resolveAppealRoute,
  type PenaltyBasis,
} from "@/lib/osa/sanctions";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import {
  formatManilaDateTime,
  formatManilaLongDate,
  formatManilaMonthDay,
} from "@/lib/utils/time";
import { AssignOfficerForm } from "@/components/cases/assign-officer-form";
import { ClassifyCaseForm } from "@/components/cases/classify-case-form";
import { ForwardAppealForm } from "@/components/cases/forward-appeal-form";
import { canClassify, isClassificationPending } from "@/lib/osa/classification";
import { MinorProcessForm } from "@/components/cases/minor-process-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { canChooseMinorProcess, minorProcessOf } from "@/lib/osa/minor-process";
import {
  CASE_STATUS_META,
  HEARING_STATUS_LABELS,
  HEARING_TYPE_LABELS,
  type CaseEscalation,
  type CaseHearing,
  type CaseSettlement,
  type CaseStatus,
  type CaseTimelineEntry,
  type HearingStatus,
} from "@/types/osa";

export const metadata: Metadata = {
  title: "Case",
};

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

interface ServiceAssignmentRow {
  id: string;
  offense_sequence: number;
  count_basis: string;
  hours_required: number;
  band_min: number | null;
  band_max: number | null;
  handbook_reference: string | null;
  service_detail: string | null;
  deadline: string | null;
  hours_completed: number;
  verifier_role: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  status: "assigned" | "in_progress" | "completed" | "not_served" | "waived";
  assigned_at: string;
}

const SERVICE_TONE: Record<ServiceAssignmentRow["status"], Tone> = {
  assigned: "warning",
  in_progress: "info",
  completed: "success",
  not_served: "danger",
  waived: "neutral",
};

interface AppealRow {
  id: string;
  penalty_basis: string;
  appellate_body: string;
  notice_received_on: string;
  appeal_deadline: string;
  filed_on: string | null;
  status: "window_open" | "filed" | "decided" | "lapsed" | "withdrawn";
  outcome: string | null;
  outcome_notes: string | null;
  decided_on: string | null;
  external_reference: string | null;
  /** Migration 00041; absent until it runs. */
  grounds?: string | null;
  filed_by_student?: boolean;
  forwarded_at?: string | null;
}

const SERVICE_LABEL: Record<ServiceAssignmentRow["status"], string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  not_served: "Not served",
  waived: "Waived",
};

const APPEAL_LABEL: Record<AppealRow["status"], string> = {
  window_open: "Appeal period open",
  filed: "Appeal filed",
  decided: "Decided",
  lapsed: "Period ended, no appeal",
  withdrawn: "Withdrawn",
};

const ESCALATION_OUTCOME_LABEL: Record<string, string> = {
  upheld: "Upheld",
  dismissed: "Dismissed",
  referred_further: "Referred further",
  sanction_recommended: "Sanction recommended",
};

/** What each section of the page is called, for the "Go to" button. */
const SECTION_LABEL: Record<CaseSection, string> = {
  classify: "Classify the case",
  schedule: "Meeting schedule",
  apology: "Apology letter",
  settlement: "Settlement",
  referrals: "Committee referrals",
  appeal: "Appeal",
  update: "Update the case",
};

const ESCALATED_STATUSES: readonly CaseStatus[] = ["escalated_pic", "escalated_sdb", "referred_codi"];

const APPEAL_TONE: Record<AppealRow["status"], Tone> = {
  window_open: "warning",
  filed: "info",
  decided: "neutral",
  lapsed: "neutral",
  withdrawn: "neutral",
};

interface ApologyLetterRow {
  id: string;
  letter_text: string | null;
  file_path: string | null;
  submitted_at: string;
  review_status: "pending" | "accepted" | "revision_requested" | "rejected";
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

const APOLOGY_TONE: Record<ApologyLetterRow["review_status"], Tone> = {
  pending: "warning",
  accepted: "success",
  revision_requested: "info",
  rejected: "danger",
};

const APOLOGY_LABEL: Record<ApologyLetterRow["review_status"], string> = {
  pending: "Awaiting your review",
  accepted: "Accepted",
  revision_requested: "Revision requested",
  rejected: "Not accepted",
};

interface CaseDetail {
  id: string;
  case_number: string;
  classification: "minor" | "major" | "confidential";
  status: CaseStatus;
  incident_date: string;
  incident_time: string | null;
  incident_location: string | null;
  description: string;
  resolution_path: string | null;
  /** Migration 00039; absent until it runs. */
  minor_process?: string | null;
  /** Migration 00049; absent until it runs. */
  classification_pending?: boolean;
  confidentiality: "normal" | "restricted" | "codi";
  assigned_officer_id: string | null;
  sanction_applied: string | null;
  resolution_notes: string | null;
  complainant_name: string | null;
  complainant_staff_id: string | null;
  created_at: string;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
    year_level: string | null;
  } | null;
  violation_types: { code: string; name: string; handbook_reference: string | null; in_handbook?: boolean } | null;
}

/**
 * One case, end to end: the facts, the schedule cross-check, the approval
 * chain, and the append-only history that makes the process auditable.
 */
export default async function StaffCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCommittee && staff.role !== "faculty")) {
    return (
      <RestrictedNotice
        title="Case"
        audience="Case files are visible to OSA officers, committee members, and the faculty member who filed the complaint."
      />
    );
  }

  const { id } = await params;
  const supabase = await createClient();
  const db = loose(supabase);

  const { data: caseData } = await db
    .from("violation_cases")
    .select(
      // "*" so minor_process (00039), classification_pending and in_handbook (00049) are read once they exist.
      "*, students(id, first_name, last_name, student_number, program, year_level), violation_types(*)",
    )
    .eq("id", id)
    .maybeSingle();

  const violationCase = caseData as CaseDetail | null;
  // RLS also returns nothing for a case this staff member may not see, which
  // is the right answer for both "missing" and "not yours".
  if (!violationCase) notFound();

  // Checklist A2: an offense outside the Student Manual is classified by the OSA.
  const unlisted = violationCase.violation_types?.in_handbook === false;
  const classificationPending = isClassificationPending(violationCase);

  // A restricted case (checklist A7): who holds it, and for the OSA head,
  // who else could. Staff names come from the service role, since staff
  // cannot list one another (00024).
  const restricted = violationCase.confidentiality === "restricted";
  const canAssign = restricted && ["osa_head", "admin"].includes(staff.role);
  let officers: Array<{ id: string; full_name: string }> = [];
  if (restricted) {
    const { data: officerRows } = await loose(createAdminClient())
      .from("staff")
      .select("id, full_name")
      .in("role_type", ["osa_officer", "osa_head"])
      .order("full_name", { ascending: true });
    officers = (officerRows as Array<{ id: string; full_name: string }> | null) ?? [];
  }
  const assignedOfficer = officers.find((officer) => officer.id === violationCase.assigned_officer_id) ?? null;

  const [
    { data: timelineRows },
    { data: hearingRows },
    { data: proposalRows },
    { data: apologyRows },
    { data: settlementRows },
    { data: escalationRows },
    { data: serviceRows },
    { data: appealRows },
  ] = await Promise.all([
      db
        .from("case_timeline")
        .select("*")
        .eq("case_id", id)
        .order("occurred_at", { ascending: false }),
      db
        .from("case_hearings")
        .select("*")
        .eq("case_id", id)
        .order("scheduled_start", { ascending: true }),
      db
        .from("hearing_slot_proposals")
        .select("id, proposed_start, proposed_end, score, rationale, rank")
        .eq("case_id", id)
        .eq("status", "suggested")
        .order("rank", { ascending: true }),
      db
        .from("apology_letters")
        .select(
          "id, letter_text, file_path, submitted_at, review_status, reviewed_at, reviewer_notes",
        )
        .eq("case_id", id)
        .order("submitted_at", { ascending: false }),
      db
        .from("case_settlements")
        .select("*")
        .eq("case_id", id)
        .order("created_at", { ascending: false }),
      db
        .from("case_escalations")
        .select("*")
        .eq("case_id", id)
        .order("escalated_at", { ascending: false }),
      db
        .from("community_service_assignments")
        .select("*")
        .eq("case_id", id)
        .order("assigned_at", { ascending: false }),
      db
        .from("case_appeals")
        .select("*")
        .eq("case_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const timeline = (timelineRows as CaseTimelineEntry[] | null) ?? [];
  const hearings = (hearingRows as CaseHearing[] | null) ?? [];
  const proposals = (proposalRows as ProposalView[] | null) ?? [];
  const apologies = (apologyRows as ApologyLetterRow[] | null) ?? [];
  const settlements = (settlementRows as CaseSettlement[] | null) ?? [];
  const escalations = (escalationRows as CaseEscalation[] | null) ?? [];
  const serviceAssignments = (serviceRows as ServiceAssignmentRow[] | null) ?? [];
  const appeals = (appealRows as AppealRow[] | null) ?? [];

  const statusMeta = CASE_STATUS_META[violationCase.status];
  const isComplainant = violationCase.complainant_staff_id === staff.staffId;

  const nextStep = caseNextStep({
    status: violationCase.status,
    classificationPending,
    letterToRead: apologies.some((letter) => letter.review_status === "pending"),
    dateAwaitingApproval: hearings.some((hearing) => hearing.status === "awaiting_complainant"),
    dateToNotify: hearings.some((hearing) => hearing.status === "complainant_approved"),
    hasSuggestedTimes: proposals.length > 0,
    hasAppeal: appeals.length > 0,
  });

  // Steps that are empty and not yet relevant are folded under "More steps"
  // rather than shown as three empty boxes. Each opens in place once used.
  const showService = staff.isOsa && violationCase.classification === "minor" && !classificationPending;
  const showSettlement = staff.isOsa;
  const showReferrals = staff.isOsa || staff.isCommittee;
  const serviceInUse = serviceAssignments.length > 0;
  const settlementInUse = settlements.length > 0 || ["in_mediation", "settled"].includes(violationCase.status);
  const referralsInUse = escalations.length > 0 || ESCALATED_STATUSES.includes(violationCase.status);
  const folded = [
    showService && !serviceInUse && "community service",
    showSettlement && !settlementInUse && "a settlement",
    showReferrals && !referralsInUse && "a committee referral",
  ].filter((name): name is string => Boolean(name));

  const serviceSection = (
<section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <HardHat className="h-4 w-4 text-muted-foreground" />
          Community service
        </h2>
        {serviceAssignments.length === 0 && (
          <CommunityServiceForm caseId={violationCase.id} />
        )}
      </div>

      {serviceAssignments.length === 0 ? (
        <p className="text-base text-muted-foreground">
          A first minor offense carries a warning and a letter of apology. From the
          second, the handbook prescribes community service: 10 to 20 hours,
          then 30 to 50. Assigning it here counts the student&rsquo;s prior offenses
          first.
        </p>
      ) : (
        <ul className="space-y-3">
          {serviceAssignments.map((assignment) => {
            const overdue =
              assignment.deadline != null &&
              ["assigned", "in_progress"].includes(assignment.status) &&
              new Date(assignment.deadline) < new Date();

            return (
              <li key={assignment.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-base font-semibold">
                    {assignment.hours_completed} / {assignment.hours_required} hours
                  </span>
                  <ToneBadge
                    label={SERVICE_LABEL[assignment.status]}
                    tone={SERVICE_TONE[assignment.status]}
                  />
                  {overdue && <ToneBadge label="Past the deadline" tone="danger" />}
                </div>

                <p className="mt-1 text-sm text-muted-foreground">
                  Offense no. {assignment.offense_sequence} &middot;{" "}
                  {assignment.band_min != null
                    ? `band ${assignment.band_min}–${assignment.band_max} hours`
                    : "no band"}{" "}
                  &middot; counted as {assignment.count_basis.replace(/_/g, " ")}
                  {assignment.handbook_reference
                    ? ` · ${assignment.handbook_reference}`
                    : ""}
                </p>

                {assignment.service_detail && (
                  <p className="mt-1.5 rounded-md bg-muted p-2 text-sm">
                    {assignment.service_detail}
                  </p>
                )}

                <p className="mt-1.5 text-sm text-muted-foreground">
                  {assignment.deadline
                    ? `Due ${formatManilaLongDate(assignment.deadline)}`
                    : "No deadline set"}
                  {assignment.verified_at
                    ? ` · verified ${formatManilaDateTime(assignment.verified_at)}${assignment.verifier_role ? ` by ${assignment.verifier_role}` : ""}`
                    : ""}
                </p>

                {assignment.verification_notes && (
                  <p className="mt-1 text-sm">{assignment.verification_notes}</p>
                )}

                {["assigned", "in_progress", "not_served"].includes(
                  assignment.status,
                ) && (
                  <ServiceProgressForm
                    assignmentId={assignment.id}
                    hoursRequired={assignment.hours_required}
                    hoursCompleted={Number(assignment.hours_completed)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const settlementSection = (
<section id="settlement" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Handshake className="h-4 w-4 text-muted-foreground" />
          Settlement
        </h2>
        {settlements.length === 0 && (
          <DraftSettlementForm
            caseId={violationCase.id}
            hearings={hearings.map((hearing) => ({
              id: hearing.id,
              label: `${HEARING_TYPE_LABELS[hearing.hearing_type] ?? hearing.hearing_type} · ${formatManilaDateTime(hearing.scheduled_start)}`,
            }))}
          />
        )}
      </div>

      {settlements.length === 0 ? (
        <p className="text-base text-muted-foreground">
          Nothing agreed yet. Draft the terms once mediation has produced an
          agreement. The student is then asked to accept them in the portal.
        </p>
      ) : (
        <ul className="space-y-3">
          {settlements.map((settlement) => {
            const allSigned =
              settlement.student_signed_at &&
              settlement.complainant_signed_at &&
              settlement.osa_witnessed_at;

            return (
              <li key={settlement.id} className="rounded-lg border border-border p-3">
                <p className="whitespace-pre-wrap text-base leading-relaxed">
                  {settlement.terms}
                </p>

                {settlement.student_obligations && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                    <strong>Student must:</strong> {settlement.student_obligations}
                    {settlement.compliance_deadline && (
                      <span className="block text-sm text-muted-foreground">
                        by {formatManilaLongDate(settlement.compliance_deadline)}
                      </span>
                    )}
                  </p>
                )}

                {/* Tri-party signature state */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                  <SignatureChip
                    label="Student"
                    signedAt={settlement.student_signed_at}
                  />
                  {settlement.complainant_signed_at ? (
                    <SignatureChip
                      label="Complainant"
                      signedAt={settlement.complainant_signed_at}
                    />
                  ) : (
                    <SettlementSignature
                      settlementId={settlement.id}
                      party="complainant"
                      label="Complainant signs"
                    />
                  )}
                  {settlement.osa_witnessed_at ? (
                    <SignatureChip
                      label="OSA witness"
                      signedAt={settlement.osa_witnessed_at}
                    />
                  ) : (
                    <SettlementSignature
                      settlementId={settlement.id}
                      party="osa"
                      label="Witness as OSA"
                    />
                  )}
                </div>

                {!settlement.student_signed_at && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Waiting on the student. They were notified and can accept from
                    their violations page.
                  </p>
                )}

                {settlement.is_complied != null && (
                  <p className="mt-2 text-sm">
                    <ToneBadge
                      label={settlement.is_complied ? "Obligations met" : "Not yet met"}
                      tone={settlement.is_complied ? "success" : "warning"}
                    />
                  </p>
                )}

                {allSigned && settlement.is_complied !== true && (
                  <ComplianceForm settlementId={settlement.id} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const referralsSection = (
<section id="referrals" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          Committee referrals
        </h2>
        {staff.isOsa && <EscalateForm caseId={violationCase.id} />}
      </div>

      {escalations.length === 0 ? (
        <p className="text-base text-muted-foreground">
          Not referred. Escalate when the OSA&apos;s own process can&apos;t resolve
          the matter. The committee&apos;s decision comes back here.
        </p>
      ) : (
        <ul className="space-y-3">
          {escalations.map((escalation) => (
            <li key={escalation.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base font-semibold">
                  {escalation.escalated_to}
                </span>
                <ToneBadge
                  label={
                    escalation.outcome && escalation.outcome !== "pending"
                      ? (ESCALATION_OUTCOME_LABEL[escalation.outcome] ?? escalation.outcome)
                      : "Deliberating"
                  }
                  tone={
                    escalation.outcome === "dismissed"
                      ? "neutral"
                      : escalation.outcome === "sanction_recommended"
                        ? "danger"
                        : escalation.outcome === "upheld"
                          ? "warning"
                          : "info"
                  }
                />
                <span className="text-sm text-muted-foreground">
                  referred {formatManilaDateTime(escalation.escalated_at)}
                  {escalation.external_reference
                    ? ` · ${escalation.external_reference}`
                    : ""}
                </span>
              </div>

              <p className="mt-1.5 text-sm text-muted-foreground">
                {escalation.reason}
              </p>

              {escalation.sanction_recommended && (
                <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-900">
                  <strong>Sanction:</strong> {escalation.sanction_recommended}
                </p>
              )}
              {escalation.outcome_notes && (
                <p className="mt-1.5 text-sm">{escalation.outcome_notes}</p>
              )}

              {(!escalation.outcome || escalation.outcome === "pending") && (
                <EscalationOutcomeForm escalationId={escalation.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Discipline cases", href: "/staff/cases" },
          { label: violationCase.case_number },
        ]}
        title={violationCase.violation_types?.name ?? "Case"}
        description={`Case ${violationCase.case_number}${violationCase.students ? ` against ${violationCase.students.first_name} ${violationCase.students.last_name}` : ""}, filed ${formatManilaDateTime(violationCase.created_at)}.`}
      >
        <ToneBadge
          label={statusMeta?.label ?? violationCase.status}
          tone={statusMeta?.tone ?? "neutral"}
          className="text-base"
        />
        {violationCase.students && (
          <Link
            href={`/staff/students/${violationCase.students.id}`}
            className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
          >
            <User className="h-4 w-4" />
            Open student record
          </Link>
        )}
      </PageHeader>

      <div className="space-y-6">
        {/* What to do next, and the status change that records it. */}
        {staff.isOsa && (
          <section
            id="update"
            aria-label="What to do next"
            className="scroll-mt-20 rounded-xl border-2 border-tup-maroon-200 bg-tup-maroon-50/40 p-5"
          >
            <h2 className="text-sm font-semibold text-tup-maroon-700">What to do next</h2>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-prose text-lg font-semibold leading-snug">{nextStep.text}</p>
              {nextStep.section && nextStep.section !== "update" && (
                <a
                  href={`#${nextStep.section}`}
                  className={cn(buttonVariants(), "gap-1.5 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
                >
                  Go to {SECTION_LABEL[nextStep.section]}
                  <ArrowRightIcon className="h-4 w-4" />
                </a>
              )}
            </div>
            <div className="mt-4 border-t border-tup-maroon-200 pt-4">
              <CaseStatusForm caseId={violationCase.id} currentStatus={violationCase.status} />
            </div>
          </section>
        )}

        {/* Facts */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 font-display text-base font-semibold">The complaint</h2>
          <p className="max-w-prose whitespace-pre-wrap text-base leading-relaxed">{violationCase.description}</p>

          <dl className="mt-4 grid gap-x-6 gap-y-3 text-base sm:grid-cols-2 xl:grid-cols-3">
            <Detail label="Student">
              {violationCase.students ? (
                <>
                  <Link
                    href={`/staff/students/${violationCase.students.id}`}
                    className="text-tup-maroon-600 underline-offset-2 hover:underline"
                  >
                    {violationCase.students.first_name} {violationCase.students.last_name}
                  </Link>
                  <span className="ml-2 whitespace-nowrap font-mono text-sm font-normal text-muted-foreground">
                    {violationCase.students.student_number}
                  </span>
                </>
              ) : (
                "Unknown student"
              )}
            </Detail>
            <Detail label="Complainant">{violationCase.complainant_name ?? "OSA-initiated"}</Detail>
            <Detail label="Incident date">
              {formatManilaLongDate(violationCase.incident_date)}
              {violationCase.incident_time ? ` · ${violationCase.incident_time}` : ""}
            </Detail>
            <Detail label="Location">{violationCase.incident_location ?? "Not given"}</Detail>
            <Detail label="Classification">
              {classificationPending
                ? "To be classified by the OSA"
                : violationCase.classification.charAt(0).toUpperCase() + violationCase.classification.slice(1)}
            </Detail>
            <Detail label="Student Manual section">
              {violationCase.violation_types?.handbook_reference ?? (unlisted ? "Not in the Student Manual" : "Not given")}
            </Detail>
          </dl>

          {staff.isOsa && canClassify({ in_handbook: violationCase.violation_types?.in_handbook, status: violationCase.status }) && (
            <div id="classify" className="mt-4 flex scroll-mt-20 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-base">
              <p className="min-w-0">
                {classificationPending ? (
                  <>
                    <span className="font-semibold">Classify this case.</span> The Student Manual does not list this
                    offense, so the OSA decides whether it is minor or major. Hearings and the minor process wait
                    until then.
                  </>
                ) : (
                  <>Not in the Student Manual: classified by the OSA as {violationCase.classification}.</>
                )}
              </p>
              <ClassifyCaseForm
                caseId={violationCase.id}
                current={classificationPending || violationCase.classification === "confidential" ? null : violationCase.classification}
              />
            </div>
          )}

          {restricted && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-base dark:border-amber-800 dark:bg-amber-950/20">
              <p className="min-w-0">
                <span className="font-semibold">Restricted.</span> Only the OSA head, the administrator and the
                assigned officer{assignedOfficer ? ` (${assignedOfficer.full_name})` : ""} can see this case.
                {!assignedOfficer && " No officer is assigned yet."}
              </p>
              {canAssign && (
                <AssignOfficerForm caseId={violationCase.id} officers={officers} current={violationCase.assigned_officer_id} />
              )}
            </div>
          )}

          {violationCase.sanction_applied && (
            <p className="mt-4 rounded-lg bg-muted p-3 text-base">
              <strong>Sanction:</strong> {violationCase.sanction_applied}
            </p>
          )}
        </section>

        {/* Scheduling */}
        <section id="schedule" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold">Meeting schedule</h2>
            {staff.isOsa && (
              <div className="flex flex-wrap gap-2">
                <ProposeSlotsButton caseId={violationCase.id} />
                <ManualHearingForm caseId={violationCase.id} />
              </div>
            )}
          </div>

          {hearings.length > 0 && (
            <ul className="mb-4 space-y-2">
              {hearings.map((hearing) => (
                <li key={hearing.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium">
                        <CalendarClock className="mr-1.5 inline h-4 w-4 text-muted-foreground" />
                        {formatManilaDateTime(hearing.scheduled_start)}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <MapPin className="mr-1 inline h-4 w-4" />
                        {hearing.venue} · {HEARING_TYPE_LABELS[hearing.hearing_type] ?? hearing.hearing_type}
                      </p>
                      <div className="mt-1.5">
                        <ToneBadge
                          label={HEARING_STATUS_LABELS[hearing.status]}
                          tone={HEARING_TONE[hearing.status]}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-start gap-2">
                      <HearingActions
                        hearingId={hearing.id}
                        status={hearing.status}
                        canApprove={isComplainant || staff.isOsa}
                        canNotify={staff.isOsa}
                      />
                      {staff.isOsa &&
                        ["student_notified", "student_acknowledged", "confirmed"].includes(
                          hearing.status,
                        ) && <NonAppearanceForm hearingId={hearing.id} />}
                    </div>
                  </div>

                  {hearing.status === "awaiting_complainant" && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Waiting for the faculty complainant to approve this date. The student is
                      summoned as soon as it is approved{staff.isOsa ? "; the OSA can approve it for them on a written approval" : ""}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {proposals.length > 0 ? (
            <>
              <p className="mb-2 text-sm font-semibold text-muted-foreground">
                Suggested times when both are free
              </p>
              <ProposalPicker proposals={proposals} />
            </>
          ) : (
            hearings.length === 0 && (
              <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
                <CalendarSearch className="h-5 w-5 text-muted-foreground/50" />
                <p className="text-base text-muted-foreground">
                  No meeting scheduled. Run the scheduler to cross-check the
                  complainant&apos;s and the student&apos;s class schedules.
                </p>
              </div>
            )
          )}
        </section>

        {/* Apology letters — the MINOR path close-out */}
        {(apologies.length > 0 || violationCase.status === "awaiting_apology") && (
          <section id="apology" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Apology letter
            </h2>

            {apologies.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-base text-muted-foreground">
                Waiting for the student to submit. They were notified when this case moved
                to &ldquo;awaiting apology&rdquo; and can submit from their violations page.
              </p>
            ) : (
              <ul className="space-y-3">
                {apologies.map((letter, index) => (
                  <li key={letter.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ToneBadge
                          label={APOLOGY_LABEL[letter.review_status]}
                          tone={APOLOGY_TONE[letter.review_status]}
                        />
                        <span className="text-sm text-muted-foreground">
                          submitted {formatManilaDateTime(letter.submitted_at)}
                          {index > 0 ? " · earlier version" : ""}
                        </span>
                      </div>
                      {letter.file_path && <ApologyFileLink letterId={letter.id} />}
                    </div>

                    {letter.letter_text ? (
                      <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-base leading-relaxed">
                        {letter.letter_text}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Submitted as an attachment only.
                      </p>
                    )}

                    {letter.reviewer_notes && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <strong>Your note:</strong> {letter.reviewer_notes}
                      </p>
                    )}

                    {staff.isOsa && letter.review_status === "pending" && (
                      <ApologyReviewControls letterId={letter.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* How a minor case is handled (checklist A4) */}
        {staff.isOsa && canChooseMinorProcess(violationCase) && !classificationPending && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-1 font-display text-base font-semibold">How this minor case is handled</h2>
            <p className="mb-3 text-base text-muted-foreground">
              Counselling then an apology letter is the usual process. For a light first offense, an apology
              letter alone or a written warning may be enough.
            </p>
            <MinorProcessForm caseId={violationCase.id} current={minorProcessOf(violationCase.minor_process)} />
          </section>
        )}

        {/* Appeal — Rules on Discipline Sec. 9 */}
        {staff.isOsa &&
          (appeals.length > 0 ||
            ["sanctioned", "escalated_sdb", "escalated_pic"].includes(
              violationCase.status,
            )) && (
          <section id="appeal" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold">
                <Scale className="h-4 w-4 text-muted-foreground" />
                Appeal
              </h2>
              {appeals.length === 0 && (
                <AppealWindowForm
                  caseId={violationCase.id}
                  escalationId={escalations[0]?.id ?? null}
                  suggestedBasis={inferPenaltyBasis(violationCase.sanction_applied)}
                />
              )}
            </div>

            {appeals.length === 0 ? (
              <p className="text-base text-muted-foreground">
                Once the Notice of Decision has been served, record the date the student
                received it. The appellate body and the 10-day deadline follow from the
                penalty, and the student is told both. The OSA does not decide the appeal.
              </p>
            ) : (
              <ul className="space-y-3">
                {appeals.map((appeal) => {
                  const window = appealWindow(appeal.notice_received_on);
                  return (
                    <li key={appeal.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ToneBadge
                          label={APPEAL_LABEL[appeal.status]}
                          tone={APPEAL_TONE[appeal.status]}
                        />
                        {appeal.status === "window_open" && (
                          <span
                            className={`text-sm font-medium ${window.daysRemaining <= 2 ? "text-red-600" : "text-muted-foreground"}`}
                          >
                            {window.isOpen
                              ? `${window.daysRemaining} day${window.daysRemaining === 1 ? "" : "s"} left`
                              : "Window has closed"}
                          </span>
                        )}
                        {appeal.external_reference && (
                          <span className="font-mono text-sm text-muted-foreground">
                            {appeal.external_reference}
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-base">
                        {resolveAppealRoute(appeal.penalty_basis as PenaltyBasis).bodyLabel}
                        <span className="block text-sm text-muted-foreground">
                          Notice received{" "}
                          {formatManilaLongDate(appeal.notice_received_on)}{" "}
                          &middot; deadline {formatManilaLongDate(appeal.appeal_deadline)}
                          {appeal.filed_on
                            ? ` · filed ${formatManilaMonthDay(appeal.filed_on)}`
                            : ""}
                        </span>
                      </p>

                      {appeal.grounds && (
                        <div className="mt-2 rounded-md border border-border p-2 text-sm">
                          <p className="mb-1 font-semibold">
                            The student&apos;s appeal{appeal.filed_by_student ? ", filed through STARS" : ""}
                          </p>
                          <p className="whitespace-pre-wrap text-muted-foreground">{appeal.grounds}</p>
                        </div>
                      )}

                      {appeal.status === "filed" &&
                        (appeal.forwarded_at ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Forwarded {formatManilaLongDate(appeal.forwarded_at)}. Record the decision below when it comes back.
                          </p>
                        ) : (
                          <ForwardAppealForm
                            appealId={appeal.id}
                            bodyLabel={resolveAppealRoute(appeal.penalty_basis as PenaltyBasis).bodyLabel}
                          />
                        ))}

                      {appeal.outcome && (
                        <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                          <strong>{appeal.outcome}</strong>
                          {appeal.decided_on
                            ? ` on ${formatManilaLongDate(appeal.decided_on)}`
                            : ""}
                          {appeal.outcome_notes ? `. ${appeal.outcome_notes}` : ""}
                        </p>
                      )}

                      {appeal.status !== "decided" && (
                        <AppealOutcomeForm appealId={appeal.id} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {showService && serviceInUse && serviceSection}
        {showSettlement && settlementInUse && settlementSection}
        {showReferrals && referralsInUse && referralsSection}

        {folded.length > 0 && (
          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
              More steps
              <span className="font-normal text-muted-foreground">({folded.join(", ")})</span>
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              {showService && !serviceInUse && serviceSection}
              {showSettlement && !settlementInUse && settlementSection}
              {showReferrals && !referralsInUse && referralsSection}
            </div>
          </details>
        )}

        {/* Timeline */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-1 flex items-center gap-2 font-display text-base font-semibold">
            <History className="h-4 w-4 text-muted-foreground" />
            Case history
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Everything done on this page is recorded here with the name of who did it. Entries can be added,
            never edited or removed.
          </p>

          {timeline.length === 0 ? (
            <p className="text-base text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-3 border-l border-border pl-4">
              {timeline.map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-tup-maroon-600"
                  />
                  <p className="text-base">{entry.summary}</p>
                  <p className="text-sm text-muted-foreground">
                    {entry.actor_label ?? "System"} · {formatManilaDateTime(entry.occurred_at)}
                    {entry.to_status ? ` · now ${CASE_STATUS_META[entry.to_status as CaseStatus]?.label ?? entry.to_status}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function SignatureChip({
  label,
  signedAt,
}: {
  label: string;
  signedAt: string | null;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${
        signedAt
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-border text-muted-foreground"
      }`}
    >
      {label}
      {signedAt ? `, signed ${formatManilaDateTime(signedAt)}` : ", not signed yet"}
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
