import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Gavel,
  GraduationCap,
  HeartHandshake,
  MessageSquareWarning,
  Send,
} from "lucide-react";

import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import {
  EmptyLine,
  GlanceStrip,
  NoticeLog,
  RecordSection,
  Row,
  RowList,
  type NoticeRow,
} from "@/components/students/record-parts";
import { getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { RISK_TIER_META, scoreStudent } from "@/lib/risk/score";
import type { RiskAssessmentResult, RiskTier } from "@/lib/risk/types";
import { recordAccess } from "@/lib/students/access";
import { summarizeRecord, type GlanceItem } from "@/lib/students/record-summary";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { formatManilaDate } from "@/lib/utils/time";
import {
  CASE_STATUS_META,
  CLEARANCE_STATUS_META,
  ID_STATUS_META,
  type CaseStatus,
  type ClearanceStatus,
  type IdValidationStatus,
} from "@/types/osa";

export const metadata: Metadata = {
  title: "Student Record",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Data minimisation (RA 10173): the profile is limited to what an officer
 * acts on. Birth date, home address, religion, physical measurements and
 * family details are on the students row but are not selected here — every
 * column rendered is a column disclosed on every view of this page.
 */
const PROFILE_COLUMNS =
  "id, user_id, student_number, first_name, middle_name, last_name, name_extension, program, department, year_level, section, campus, scholastic_status, cellphone, email_address, is_pwd, is_indigenous, is_listahan";

// ============================================================
// ROW SHAPES
// ============================================================

interface StudentProfile {
  id: string;
  user_id: string;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  name_extension: string | null;
  program: string;
  department: string;
  year_level: string;
  section: string | null;
  campus: string;
  scholastic_status: string;
  cellphone: string | null;
  email_address: string;
  is_pwd: boolean;
  is_indigenous: boolean;
  is_listahan: boolean;
}

interface CaseRow {
  id: string;
  case_number: string;
  classification: "minor" | "major" | "confidential";
  status: CaseStatus;
  confidentiality: string;
  incident_date: string;
  created_at: string;
  sanction_applied: string | null;
  violation_types: { name: string } | null;
}

interface ServiceRow {
  id: string;
  case_id: string;
  hours_required: number;
  hours_completed: number | string;
  deadline: string | null;
  status: string;
}

interface AppealRow {
  id: string;
  appellate_body: string;
  appeal_deadline: string;
  status: string;
  outcome: string | null;
  violation_cases: { case_number: string } | null;
}

interface ClearanceRow {
  id: string;
  request_number: string;
  request_type: string;
  status: ClearanceStatus;
  created_at: string;
  clearance_holds: Array<{ id: string; resolved_at: string | null }> | null;
}

interface IdRow {
  id: string;
  school_year: string;
  semester: string;
  status: IdValidationStatus;
  validated_at: string | null;
}

interface DocumentRow {
  id: string;
  document_type: string;
  school_year: string;
  semester: string;
  processing_status: string;
  uploaded_at: string;
}

interface ScholarshipRow {
  id: string;
  status: string;
  school_year: string;
  semester: string | null;
  scholarships: { name: string } | null;
}

interface ConcernRow {
  id: string;
  subject_line: string;
  category: string;
  status: string;
  urgency_level: string | null;
  created_at: string;
}

interface InterventionRow {
  id: string;
  intervention_type: string;
  status: string;
  priority: string;
  scheduled_for: string | null;
  created_at: string;
}

/** Scheduling facts only — never presenting_concern, summary or notes. */
interface GuidanceRow {
  id: string;
  session_type: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

const TIER_TONE: Record<RiskTier, Tone> = {
  low: "success",
  moderate: "info",
  high: "warning",
  critical: "danger",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  good_moral: "Good Moral",
  graduation_clearance: "Graduation",
  transfer_clearance: "Transfer",
  general_clearance: "General",
};

const DOCUMENT_LABELS: Record<string, string> = {
  certificate_of_registration: "Certificate of Registration",
  rating_slip: "Rating slip",
  transcript: "Transcript",
};

const APPELLATE_BODY_LABELS: Record<string, string> = {
  vpaa_or_campus_director: "VPAA / Campus Director",
  office_of_the_president: "Office of the President",
  board_of_regents: "Board of Regents",
};

function humanize(value: string): string {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fullName(student: StudentProfile): string {
  const middle = student.middle_name ? ` ${student.middle_name.charAt(0)}.` : "";
  const extension = student.name_extension ? ` ${student.name_extension}` : "";
  return `${student.first_name}${middle} ${student.last_name}${extension}`;
}

/** Reads a query result, and says so in the logs when the database refused. */
async function rows<T>(
  label: string,
  query: PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) console.error(`[student record] ${label} query failed`, error);
  return (data as T[] | null) ?? [];
}

// ============================================================
// PAGE
// ============================================================

/**
 * One student, as the OSA knows them.
 *
 * Nine working screens link here — cases, clearance, concerns, documents,
 * guidance, interventions, risk and scholarships — and until now every one
 * of those links led to a placeholder. This page brings those records
 * together, with two additions none of the queues offer on their own:
 *
 *   * proof of service — every notice the system sent this student, and
 *     whether it was opened or emailed, for the moment an officer has to
 *     decide whether a student who did not appear was ever told to;
 *   * the same live early-warning score as /staff/risk, so the two pages
 *     cannot disagree about the same student.
 *
 * Opening the page is audit-logged: the record aggregates discipline, risk
 * and clearance in one view, and RA 10173 cares who looked as much as who
 * changed something.
 */
export default async function StaffStudentRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Which sections this viewer may see. RLS still filters every row; this
  // decides whether a section is shown at all (see lib/students/access.ts).
  const staff = await getStaffContext();
  const access = staff ? recordAccess(staff) : null;
  if (!staff || !access) {
    return (
      <RestrictedNotice
        title="Student Record"
        audience="Student records are open to OSA staff, guidance, the disciplinary committees, and — for clearance and ID matters only — the Registrar and Cashier."
      />
    );
  }

  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: studentRow, error: studentError } = await db
    .from("students")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (studentError) console.error("[student record] profile query failed", studentError);

  const student = studentRow as StudentProfile | null;
  if (!student) notFound();

  await logAuditEvent(staff.userId, "student_record_viewed", "students", {
    student_id: student.id,
    student_number: student.student_number,
    sections: Object.entries(access)
      .filter(([, allowed]) => allowed)
      .map(([section]) => section),
  });

  const term = getCurrentTerm();
  const none = Promise.resolve(null);

  const [
    cases,
    service,
    appeals,
    notices,
    clearance,
    idValidations,
    documents,
    scholarships,
    concerns,
    interventions,
    guidance,
    riskInputs,
  ] = await Promise.all([
    access.osaRecord
      ? rows<CaseRow>(
          "cases",
          db
            .from("violation_cases")
            .select(
              "id, case_number, classification, status, confidentiality, incident_date, created_at, sanction_applied, violation_types(name)",
            )
            .eq("student_id", id)
            .order("created_at", { ascending: false })
            .limit(50),
        )
      : none,
    access.osaRecord
      ? rows<ServiceRow>(
          "service",
          db
            .from("community_service_assignments")
            .select("id, case_id, hours_required, hours_completed, deadline, status")
            .eq("student_id", id)
            .order("created_at", { ascending: false }),
        )
      : none,
    access.osaRecord
      ? rows<AppealRow>(
          "appeals",
          db
            .from("case_appeals")
            .select(
              "id, appellate_body, appeal_deadline, status, outcome, violation_cases!inner(case_number, student_id)",
            )
            .eq("violation_cases.student_id", id)
            .order("appeal_deadline", { ascending: false })
            .limit(10),
        )
      : none,
    access.osaRecord
      ? rows<NoticeRow>(
          "notices",
          db
            .from("notifications")
            .select(
              "id, title, notification_type, channels, is_read, read_at, email_status, email_sent_at, email_recipient, created_at",
            )
            .eq("user_id", student.user_id)
            .not("related_entity_type", "is", null)
            .order("created_at", { ascending: false })
            .limit(25),
        )
      : none,
    rows<ClearanceRow>(
      "clearance",
      db
        .from("clearance_requests")
        .select("id, request_number, request_type, status, created_at, clearance_holds(id, resolved_at)")
        .eq("student_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
    ),
    rows<IdRow>(
      "id validation",
      db
        .from("id_validations")
        .select("id, school_year, semester, status, validated_at")
        .eq("student_id", id)
        .order("created_at", { ascending: false })
        .limit(6),
    ),
    access.osaRecord
      ? rows<DocumentRow>(
          "documents",
          db
            .from("academic_documents")
            .select("id, document_type, school_year, semester, processing_status, uploaded_at")
            .eq("student_id", id)
            .order("uploaded_at", { ascending: false })
            .limit(8),
        )
      : none,
    access.osaRecord
      ? rows<ScholarshipRow>(
          "scholarships",
          db
            .from("scholarship_applications")
            .select("id, status, school_year, semester, scholarships(name)")
            .eq("student_id", id)
            .order("created_at", { ascending: false })
            .limit(8),
        )
      : none,
    access.osaRecord
      ? rows<ConcernRow>(
          "concerns",
          db
            .from("concerns")
            .select("id, subject_line, category, status, urgency_level, created_at")
            .eq("student_id", id)
            .order("created_at", { ascending: false })
            .limit(8),
        )
      : none,
    access.risk
      ? rows<InterventionRow>(
          "interventions",
          db
            .from("risk_interventions")
            .select("id, intervention_type, status, priority, scheduled_for, created_at")
            .eq("student_id", id)
            .order("created_at", { ascending: false })
            .limit(8),
        )
      : none,
    access.guidance
      ? rows<GuidanceRow>(
          "guidance",
          db
            .from("guidance_sessions")
            .select("id, session_type, status, scheduled_at, created_at")
            .eq("student_id", id)
            .order("created_at", { ascending: false })
            .limit(8),
        )
      : none,
    access.risk
      ? Promise.all([loadActiveRiskModel(db), loadRiskFeatures(db, { studentId: id, limit: 1 })])
      : none,
  ]);

  // Scored exactly as /staff/risk scores, so the two pages agree.
  let risk: RiskAssessmentResult | null = null;
  let riskUnavailable: string | null = null;
  if (riskInputs) {
    const [model, features] = riskInputs;
    if (!model) riskUnavailable = "No risk model is active, so nothing can be scored.";
    else if (features.length === 0) riskUnavailable = "No academic data on file to score yet.";
    else risk = scoreStudent(featuresToInputs(features[0]), model);
  }

  const glance: GlanceItem[] = summarizeRecord({
    cases,
    service,
    clearance,
    idValidations,
    term,
  });
  if (risk) {
    glance.push({
      key: "risk",
      label: "Early warning",
      value: `${RISK_TIER_META[risk.risk_tier].label} · ${Math.round(risk.risk_score * 100)}%`,
      tone: TIER_TONE[risk.risk_tier],
    });
  }

  const name = fullName(student);

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Students", href: "/staff/students" },
          { label: name },
        ]}
        title={name}
        description={`${student.student_number} · ${student.program} · ${student.year_level}${student.section ? `-${student.section}` : ""}`}
      />

      <div className="space-y-6">
        <IdentityCard student={student} showEquityFlags={access.osaRecord} />

        <GlanceStrip items={glance} />

        {!access.osaRecord && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            You are seeing the clearance and ID parts of this record. Disciplinary, early-warning
            and guidance records are limited to OSA staff.
          </p>
        )}

        <div className={access.osaRecord ? "grid gap-6 lg:grid-cols-3" : "grid gap-6 md:grid-cols-2"}>
          {access.osaRecord && (
            <div className="space-y-6 lg:col-span-2">
              <DisciplineSection
                cases={cases ?? []}
                service={service ?? []}
                appeals={appeals ?? []}
                viewerSeesConfidential={staff.canAccessConfidential}
              />

              <RecordSection title="Notices served" icon={Send} count={notices?.length}>
                {notices && notices.length > 0 ? (
                  <NoticeLog notices={notices} />
                ) : (
                  <EmptyLine>
                    No disciplinary, clearance, scholarship or ID notices have been sent to this
                    student.
                  </EmptyLine>
                )}
              </RecordSection>

              {access.risk && (
                <EarlyWarningSection
                  risk={risk}
                  unavailable={riskUnavailable}
                  interventions={interventions ?? []}
                />
              )}

              {access.guidance ? (
                <RecordSection
                  title="Guidance"
                  icon={HeartHandshake}
                  count={guidance?.length}
                  href="/staff/guidance"
                  hrefLabel="Open guidance"
                >
                  {guidance && guidance.length > 0 ? (
                    <RowList>
                      {guidance.map((session) => (
                        <Row key={session.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px]">{humanize(session.session_type)}</span>
                            <span className="flex items-center gap-2">
                              <ToneBadge label={humanize(session.status)} tone="neutral" />
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatManilaDate(session.scheduled_at ?? session.created_at)}
                              </span>
                            </span>
                          </div>
                        </Row>
                      ))}
                    </RowList>
                  ) : (
                    <EmptyLine>No guidance sessions on record.</EmptyLine>
                  )}
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Scheduling only. Session notes stay on the guidance screen, with the counselor.
                  </p>
                </RecordSection>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Counselling records are kept by Guidance and are not shown on this page.
                </p>
              )}
            </div>
          )}

          <div className="space-y-6">
            <RecordSection
              title="Clearance"
              icon={ClipboardCheck}
              count={clearance.length}
              href="/staff/clearance"
            >
              {clearance.length > 0 ? (
                <RowList>
                  {clearance.map((request) => {
                    const meta = CLEARANCE_STATUS_META[request.status];
                    const openHolds = (request.clearance_holds ?? []).filter((hold) => !hold.resolved_at).length;
                    return (
                      <Row key={request.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px]">
                            {REQUEST_TYPE_LABELS[request.request_type] ?? humanize(request.request_type)}
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                              {request.request_number}
                            </span>
                          </span>
                          <ToneBadge label={meta.label} tone={meta.tone} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Filed {formatManilaDate(request.created_at)}
                          {openHolds > 0 && (
                            <span className="text-red-700">
                              {" "}
                              · {openHolds} open hold{openHolds === 1 ? "" : "s"}
                            </span>
                          )}
                        </p>
                      </Row>
                    );
                  })}
                </RowList>
              ) : (
                <EmptyLine>No clearance requests filed.</EmptyLine>
              )}
            </RecordSection>

            <RecordSection
              title="ID validation"
              icon={BadgeCheck}
              count={idValidations.length}
              href="/staff/id-validation"
            >
              {idValidations.length > 0 ? (
                <RowList>
                  {idValidations.map((validation) => {
                    const meta = ID_STATUS_META[validation.status];
                    const isCurrent =
                      validation.school_year === term.schoolYear && validation.semester === term.semester;
                    return (
                      <Row key={validation.id}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[13px]">
                            {validation.semester}, {validation.school_year}
                            {isCurrent && (
                              <span className="ml-1.5 text-[11px] text-muted-foreground">(this term)</span>
                            )}
                          </span>
                          <ToneBadge label={meta.label} tone={meta.tone} />
                        </div>
                      </Row>
                    );
                  })}
                </RowList>
              ) : (
                <EmptyLine>Never submitted for validation.</EmptyLine>
              )}
            </RecordSection>

            {access.osaRecord && (
              <>
                <RecordSection
                  title="Scholarships"
                  icon={GraduationCap}
                  count={scholarships?.length}
                  href="/staff/scholarships"
                >
                  {scholarships && scholarships.length > 0 ? (
                    <RowList>
                      {scholarships.map((application) => (
                        <Row key={application.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px]">
                              {application.scholarships?.name ?? "Scholarship"}
                            </span>
                            <ToneBadge
                              label={humanize(application.status)}
                              tone={
                                application.status === "awarded"
                                  ? "success"
                                  : application.status === "rejected" || application.status === "withdrawn"
                                    ? "neutral"
                                    : "info"
                              }
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {application.semester ? `${application.semester}, ` : ""}
                            {application.school_year}
                          </p>
                        </Row>
                      ))}
                    </RowList>
                  ) : (
                    <EmptyLine>No scholarship applications.</EmptyLine>
                  )}
                </RecordSection>

                <RecordSection
                  title="Academic documents"
                  icon={FileText}
                  count={documents?.length}
                  href="/staff/documents"
                >
                  {documents && documents.length > 0 ? (
                    <RowList>
                      {documents.map((document) => (
                        <Row key={document.id}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px]">
                              {DOCUMENT_LABELS[document.document_type] ?? humanize(document.document_type)}
                            </span>
                            <ToneBadge
                              label={humanize(document.processing_status)}
                              tone={
                                document.processing_status === "verified"
                                  ? "success"
                                  : document.processing_status === "rejected" ||
                                      document.processing_status === "verification_failed"
                                    ? "danger"
                                    : "info"
                              }
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {document.semester}, {document.school_year} · uploaded{" "}
                            {formatManilaDate(document.uploaded_at)}
                          </p>
                        </Row>
                      ))}
                    </RowList>
                  ) : (
                    <EmptyLine>No COR or rating slips uploaded.</EmptyLine>
                  )}
                </RecordSection>

                <RecordSection
                  title="Concerns"
                  icon={MessageSquareWarning}
                  count={concerns?.length}
                  href="/staff/concerns"
                >
                  {concerns && concerns.length > 0 ? (
                    <RowList>
                      {concerns.map((concern) => (
                        <Row key={concern.id}>
                          <Link
                            href={`/staff/concerns/${concern.id}`}
                            className="text-[13px] text-tup-maroon-600 underline-offset-2 hover:underline"
                          >
                            {concern.subject_line}
                          </Link>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {concern.category} · {humanize(concern.status)}
                            {concern.urgency_level ? ` · ${concern.urgency_level} urgency` : ""} ·{" "}
                            {formatManilaDate(concern.created_at)}
                          </p>
                        </Row>
                      ))}
                    </RowList>
                  ) : (
                    <EmptyLine>No concerns filed.</EmptyLine>
                  )}
                </RecordSection>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SECTIONS
// ============================================================

function IdentityCard({
  student,
  showEquityFlags,
}: {
  student: StudentProfile;
  showEquityFlags: boolean;
}) {
  const initials = `${student.first_name.charAt(0)}${student.last_name.charAt(0)}`.toUpperCase();

  const details: Array<[string, string]> = [
    ["Student number", student.student_number],
    ["Program", student.program],
    ["Department", student.department],
    ["Year & section", `${student.year_level}${student.section ? ` · ${student.section}` : ""}`],
    ["Campus", student.campus],
    ["Scholastic status", student.scholastic_status],
    ["Mobile", student.cellphone ?? "—"],
    ["Personal email", student.email_address],
  ];

  // Sensitive personal information under RA 10173 (health, ethnic origin).
  // Shown only to OSA roles, who need it for scholarship eligibility.
  const flags = showEquityFlags
    ? [
        student.is_pwd && "Person with disability",
        student.is_indigenous && "Indigenous Peoples",
        student.is_listahan && "Listahanan household",
      ].filter((flag): flag is string => Boolean(flag))
    : [];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div
          aria-hidden="true"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tup-maroon-600/10 font-display text-base font-semibold text-tup-maroon-700"
        >
          {initials}
        </div>

        <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
              </dt>
              <dd className="truncate text-[13px]" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {flags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {flags.map((flag) => (
            <ToneBadge key={flag} label={flag} tone="neutral" />
          ))}
        </div>
      )}
    </section>
  );
}

function DisciplineSection({
  cases,
  service,
  appeals,
  viewerSeesConfidential,
}: {
  cases: CaseRow[];
  service: ServiceRow[];
  appeals: AppealRow[];
  viewerSeesConfidential: boolean;
}) {
  const openService = service.filter((row) => ["assigned", "in_progress", "not_served"].includes(row.status));
  const openAppeals = appeals.filter((appeal) => appeal.status === "window_open" || appeal.status === "filed");

  return (
    <RecordSection title="Discipline" icon={Gavel} count={cases.length} href="/staff/cases" hrefLabel="All cases">
      {cases.length > 0 ? (
        <RowList>
          {cases.map((violationCase) => {
            const meta = CASE_STATUS_META[violationCase.status];
            return (
              <Row key={violationCase.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/staff/cases/${violationCase.id}`}
                      className="font-mono text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
                    >
                      {violationCase.case_number}
                    </Link>
                    <span className="truncate text-[13px]">
                      {violationCase.violation_types?.name ?? "Unclassified offense"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {violationCase.confidentiality === "codi" && (
                      <ToneBadge label="Confidential" tone="danger" />
                    )}
                    <ToneBadge
                      label={humanize(violationCase.classification)}
                      tone={violationCase.classification === "minor" ? "neutral" : "warning"}
                    />
                    <ToneBadge label={meta.label} tone={meta.tone} />
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Incident {formatManilaDate(violationCase.incident_date)} · filed{" "}
                  {formatManilaDate(violationCase.created_at)}
                  {violationCase.sanction_applied ? ` · sanction: ${violationCase.sanction_applied}` : ""}
                </p>
              </Row>
            );
          })}
        </RowList>
      ) : (
        <EmptyLine>No disciplinary cases on record.</EmptyLine>
      )}

      {(openService.length > 0 || openAppeals.length > 0) && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {openService.map((row) => {
            const completed = Number(row.hours_completed);
            return (
              <p key={row.id} className="text-[12px]">
                <span className="font-medium">Community service:</span>{" "}
                <span className="tabular-nums">
                  {completed} of {row.hours_required} hours
                </span>
                {row.deadline && (
                  <span className="text-muted-foreground"> · due {formatManilaDate(row.deadline)}</span>
                )}
              </p>
            );
          })}
          {openAppeals.map((appeal) => (
            <p key={appeal.id} className="text-[12px]">
              <span className="font-medium">
                {appeal.status === "filed" ? "Appeal filed" : "Appeal window open"}:
              </span>{" "}
              {appeal.violation_cases?.case_number} to{" "}
              {APPELLATE_BODY_LABELS[appeal.appellate_body] ?? humanize(appeal.appellate_body)}
              {appeal.status === "window_open" && (
                <span className="text-muted-foreground">
                  {" "}
                  · closes {formatManilaDate(appeal.appeal_deadline)}
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {/*
        Shown to every viewer without clearance, whether or not such a case
        exists. Conditioning it on existence would disclose the very thing
        CODI confidentiality protects; stating it always keeps "no cases"
        from being read as a guarantee.
      */}
      {!viewerSeesConfidential && (
        <p className="mt-4 text-[11px] text-muted-foreground">
          Cases referred to CODI are visible only to cleared personnel and are not counted here.
        </p>
      )}
    </RecordSection>
  );
}

function EarlyWarningSection({
  risk,
  unavailable,
  interventions,
}: {
  risk: RiskAssessmentResult | null;
  unavailable: string | null;
  interventions: InterventionRow[];
}) {
  return (
    <RecordSection title="Early warning" icon={Activity} href="/staff/risk" hrefLabel="Risk queue">
      {risk ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {Math.round(risk.risk_score * 100)}
              <span className="text-sm text-muted-foreground">%</span>
            </p>
            <ToneBadge label={RISK_TIER_META[risk.risk_tier].label} tone={TIER_TONE[risk.risk_tier]} />
            {risk.lowConfidence && <ToneBadge label="Low confidence" tone="neutral" />}
            <span className="text-[11px] text-muted-foreground">
              {Math.round(risk.dataCompleteness * 100)}% of signals on file
            </span>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What raises the score
            </p>
            {risk.topRiskFactors.length === 0 ? (
              <EmptyLine>Nothing above the neutral baseline.</EmptyLine>
            ) : (
              <ul className="space-y-1.5">
                {risk.topRiskFactors.slice(0, 3).map((factor) => (
                  <li key={factor.feature} className="text-[12px]">
                    <span className="font-medium">{factor.label}</span>
                    {factor.imputed && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(assumed — no data)</span>
                    )}
                    <span className="block text-[11px] text-muted-foreground">{factor.explanation}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <EmptyLine>{unavailable ?? "Not scored."}</EmptyLine>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Interventions
        </p>
        {interventions.length > 0 ? (
          <RowList>
            {interventions.map((intervention) => (
              <Row key={intervention.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px]">{humanize(intervention.intervention_type)}</span>
                  <span className="flex items-center gap-2">
                    <ToneBadge
                      label={humanize(intervention.status)}
                      tone={intervention.status === "completed" ? "success" : "info"}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatManilaDate(intervention.scheduled_for ?? intervention.created_at)}
                    </span>
                  </span>
                </div>
              </Row>
            ))}
          </RowList>
        ) : (
          <EmptyLine>None opened.</EmptyLine>
        )}
      </div>
    </RecordSection>
  );
}
