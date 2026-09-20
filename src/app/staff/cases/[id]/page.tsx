import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarClock,
  CalendarSearch,
  History,
  Mail,
  MapPin,
  User,
} from "lucide-react";

import {
  ApologyFileLink,
  ApologyReviewControls,
} from "@/components/cases/apology-review";
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
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import {
  CASE_STATUS_META,
  HEARING_STATUS_LABELS,
  type CaseHearing,
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
  violation_types: { code: string; name: string; handbook_reference: string | null } | null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
      "id, case_number, classification, status, incident_date, incident_time, incident_location, description, resolution_path, sanction_applied, resolution_notes, complainant_name, complainant_staff_id, created_at, students(id, first_name, last_name, student_number, program, year_level), violation_types(code, name, handbook_reference)",
    )
    .eq("id", id)
    .maybeSingle();

  const violationCase = caseData as CaseDetail | null;
  // RLS also returns nothing for a case this staff member may not see, which
  // is the right answer for both "missing" and "not yours".
  if (!violationCase) notFound();

  const [
    { data: timelineRows },
    { data: hearingRows },
    { data: proposalRows },
    { data: apologyRows },
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
    ]);

  const timeline = (timelineRows as CaseTimelineEntry[] | null) ?? [];
  const hearings = (hearingRows as CaseHearing[] | null) ?? [];
  const proposals = (proposalRows as ProposalView[] | null) ?? [];
  const apologies = (apologyRows as ApologyLetterRow[] | null) ?? [];

  const statusMeta = CASE_STATUS_META[violationCase.status];
  const isComplainant = violationCase.complainant_staff_id === staff.staffId;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Cases", href: "/staff/cases" },
          { label: violationCase.case_number },
        ]}
        title={violationCase.violation_types?.name ?? "Case"}
        description={`${violationCase.case_number} · filed ${formatDateTime(violationCase.created_at)}`}
      >
        <ToneBadge
          label={statusMeta?.label ?? violationCase.status}
          tone={statusMeta?.tone ?? "neutral"}
        />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {/* Facts */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 font-display text-base font-semibold">The complaint</h2>
            <p className="text-[13px] leading-relaxed">{violationCase.description}</p>

            <dl className="mt-4 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
              <Detail label="Student">
                {violationCase.students ? (
                  <Link
                    href={`/staff/students/${violationCase.students.id}`}
                    className="text-tup-maroon-600 underline-offset-2 hover:underline"
                  >
                    {violationCase.students.first_name} {violationCase.students.last_name} (
                    {violationCase.students.student_number})
                  </Link>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="Complainant">{violationCase.complainant_name ?? "OSA-initiated"}</Detail>
              <Detail label="Incident date">
                {new Date(violationCase.incident_date).toLocaleDateString("en-PH", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                {violationCase.incident_time ? ` · ${violationCase.incident_time}` : ""}
              </Detail>
              <Detail label="Location">{violationCase.incident_location ?? "—"}</Detail>
              <Detail label="Classification">{violationCase.classification}</Detail>
              <Detail label="Handbook">
                {violationCase.violation_types?.handbook_reference ?? "—"}
              </Detail>
            </dl>

            {violationCase.sanction_applied && (
              <p className="mt-4 rounded-lg bg-muted p-3 text-[12px]">
                <strong>Sanction:</strong> {violationCase.sanction_applied}
              </p>
            )}
          </section>

          {/* Scheduling */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold">Meeting schedule</h2>
              {staff.isOsa && <ProposeSlotsButton caseId={violationCase.id} />}
            </div>

            {hearings.length > 0 && (
              <ul className="mb-4 space-y-2">
                {hearings.map((hearing) => (
                  <li key={hearing.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">
                          <CalendarClock className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                          {formatDateTime(hearing.scheduled_start)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          <MapPin className="mr-1 inline h-3 w-3" />
                          {hearing.venue} · {hearing.hearing_type.replace(/_/g, " ")}
                        </p>
                        <div className="mt-1.5">
                          <ToneBadge
                            label={HEARING_STATUS_LABELS[hearing.status]}
                            tone={HEARING_TONE[hearing.status]}
                          />
                        </div>
                      </div>

                      <HearingActions
                        hearingId={hearing.id}
                        status={hearing.status}
                        canApprove={isComplainant || staff.isOsa}
                        canNotify={staff.isOsa}
                      />
                    </div>

                    {hearing.status === "awaiting_complainant" && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        The student is not told about this date until the complainant
                        approves it.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {proposals.length > 0 ? (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Proposed slots — both parties free
                </p>
                <ProposalPicker proposals={proposals} />
              </>
            ) : (
              hearings.length === 0 && (
                <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
                  <CalendarSearch className="h-5 w-5 text-muted-foreground/50" />
                  <p className="text-[13px] text-muted-foreground">
                    No meeting scheduled. Run the scheduler to cross-check the
                    complainant&apos;s and the student&apos;s class schedules.
                  </p>
                </div>
              )
            )}
          </section>

          {/* Apology letters — the MINOR path close-out */}
          {(apologies.length > 0 || violationCase.status === "awaiting_apology") && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Apology letter
              </h2>

              {apologies.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
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
                          <span className="text-[11px] text-muted-foreground">
                            submitted {formatDateTime(letter.submitted_at)}
                            {index > 0 ? " · earlier version" : ""}
                          </span>
                        </div>
                        {letter.file_path && <ApologyFileLink letterId={letter.id} />}
                      </div>

                      {letter.letter_text ? (
                        <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-[13px] leading-relaxed">
                          {letter.letter_text}
                        </p>
                      ) : (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          Submitted as an attachment only.
                        </p>
                      )}

                      {letter.reviewer_notes && (
                        <p className="mt-2 text-[12px] text-muted-foreground">
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

          {/* Timeline */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-semibold">
              <History className="h-4 w-4 text-muted-foreground" />
              Case history
            </h2>

            {timeline.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3 border-l border-border pl-4">
                {timeline.map((entry) => (
                  <li key={entry.id} className="relative">
                    <span
                      aria-hidden="true"
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-tup-maroon-600"
                    />
                    <p className="text-[13px]">{entry.summary}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.actor_label ?? "System"} · {formatDateTime(entry.occurred_at)}
                      {entry.to_status ? ` · → ${entry.to_status}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Side rail */}
        <div className="space-y-4">
          {violationCase.students && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Student
              </h2>
              <p className="text-[13px] font-medium">
                {violationCase.students.first_name} {violationCase.students.last_name}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {violationCase.students.student_number}
              </p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {violationCase.students.program} · {violationCase.students.year_level}
              </p>
              <Link
                href={`/staff/students/${violationCase.students.id}`}
                className="mt-2 inline-block text-[12px] text-tup-maroon-600 underline-offset-2 hover:underline"
              >
                Open full record
              </Link>
            </section>
          )}

          {staff.isOsa && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-2 font-display text-sm font-semibold">Update case</h2>
              <CaseStatusForm caseId={violationCase.id} currentStatus={violationCase.status} />
            </section>
          )}

          <p className="rounded-xl border border-border bg-muted/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
            Everything on this page is recorded in the case history with your name. The
            history is append-only — entries can be added, never edited or removed.
          </p>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
