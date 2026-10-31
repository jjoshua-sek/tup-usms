import type { Metadata } from "next";
import Link from "next/link";
import { MedalIcon as Award, CaretDownIcon as ChevronDown, HandHeartIcon as HandHeart } from "@phosphor-icons/react/ssr";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { ApplicationStatusForm } from "@/components/scholarships/application-status-form";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { buildStudentEligibilityProfile } from "@/lib/scholarships/build-profile";
import type { ScholarshipCriterion } from "@/lib/scholarships/evaluate-eligibility";
import { RETENTION_META, checkRetention } from "@/lib/scholarships/retention";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDay } from "@/lib/utils/time";
import { APPLICATION_OPEN, APPLICATION_STATUS_LABELS, FUNDING_TYPE_LABELS, type Scholarship } from "@/types/osa";

export const metadata: Metadata = {
  title: "Scholarships",
};

export const revalidate = 30;

const STATUS_TONE: Record<string, Tone> = {
  interest_declared: "neutral",
  documents_pending: "warning",
  documents_complete: "info",
  under_review: "info",
  endorsed: "success",
  forwarded: "success",
  awarded: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

interface ApplicationRow {
  id: string;
  scholarship_id: string;
  status: string;
  school_year: string;
  semester: string | null;
  created_at: string;
  endorsement_notes: string | null;
  rejection_reason: string | null;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
  } | null;
  scholarships: { name: string; sponsor_name: string } | null;
}

/**
 * Scholarship administration.
 *
 * Two jobs: keep the catalogue honest (slots, deadlines, criteria) so the
 * student-side eligibility engine has something true to evaluate against, and
 * work the queue of students who have declared interest.
 */
export default async function StaffScholarshipsPage() {
  const staff = await getStaffContext();
  if (!staff?.isOsa) {
    return (
      <RestrictedNotice
        title="Scholarships"
        audience="Scholarship administration is handled by OSA officers."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const [{ data: scholarshipRows }, { data: applicationRows }] = await Promise.all([
    db
      .from("scholarships")
      .select("*, scholarship_criteria(id), scholarship_requirements(id)")
      .order("name", { ascending: true }),
    db
      .from("scholarship_applications")
      .select(
        "id, scholarship_id, status, school_year, semester, created_at, endorsement_notes, rejection_reason, students(id, first_name, last_name, student_number, program), scholarships(name, sponsor_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const scholarships =
    (scholarshipRows as Array<
      Scholarship & {
        scholarship_criteria: unknown[] | null;
        scholarship_requirements: unknown[] | null;
      }
    > | null) ?? [];
  const applications = (applicationRows as ApplicationRow[] | null) ?? [];

  const active = scholarships.filter((scholarship) => scholarship.is_active);
  const pending = applications.filter((application) => APPLICATION_OPEN.includes(application.status));
  const decided = applications.filter((application) => !APPLICATION_OPEN.includes(application.status));
  const awarded = applications.filter((application) => application.status === "awarded");

  // Scholars after the award (checklist F3): do they still meet the grade
  // and conduct requirements, on their latest verified grades?
  const scholarIds = [...new Set(awarded.map((a) => a.students?.id).filter((id): id is string => Boolean(id)))].slice(0, 100);
  const [{ data: criteriaRows }, { data: snapshotRows }, profiles] = await Promise.all([
    awarded.length
      ? db.from("scholarship_criteria").select("*").in("scholarship_id", [...new Set(awarded.map((a) => a.scholarship_id))])
      : Promise.resolve({ data: [] }),
    scholarIds.length
      ? db
          .from("academic_snapshots")
          .select("student_id, school_year, semester, term_sequence")
          .in("student_id", scholarIds)
          // The term the GWA comes from: a COR's term has units but no grades.
          .not("gwa", "is", null)
          .order("term_sequence", { ascending: false })
      : Promise.resolve({ data: [] }),
    Promise.all(scholarIds.map((id) => buildStudentEligibilityProfile(db, id))),
  ]);
  const criteriaFor = (scholarshipId: string) =>
    ((criteriaRows as ScholarshipCriterion[] | null) ?? []).filter((c) => c.scholarship_id === scholarshipId);
  const gradesTerm = new Map<string, string>();
  for (const row of (snapshotRows as Array<{ student_id: string; school_year: string; semester: string }> | null) ?? []) {
    if (!gradesTerm.has(row.student_id)) gradesTerm.set(row.student_id, `${row.semester}, ${row.school_year}`);
  }
  const profileOf = new Map(profiles.map((profile) => [profile.student_id, profile]));
  const scholars = awarded
    .filter((a) => a.students && profileOf.has(a.students.id))
    .map((a) => ({ application: a, retention: checkRetention(a.scholarship_id, criteriaFor(a.scholarship_id), profileOf.get(a.students!.id)!) }))
    .sort((x, y) => ["at_risk", "unknown", "keeps"].indexOf(x.retention.status) - ["at_risk", "unknown", "keeps"].indexOf(y.retention.status));
  const atRisk = scholars.filter((s) => s.retention.status === "at_risk").length;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Scholarships" }]}
        title="Scholarships"
        description="Students who intend to apply, the scholars who must keep their grades up, and the programs students are matched against."
      />

      {/* Applications waiting on the OSA */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Waiting for the OSA
          <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
            {pending.length}
          </span>
        </h2>
        <p className="mb-3 mt-0.5 text-base text-muted-foreground">
          Check each student&apos;s documents, then endorse, send to the sponsor, or decline.
        </p>
        {pending.length === 0 ? (
          <EmptyState
            icon={HandHeart}
            title="Nobody waiting"
            description="Students land here when they press “I intend to apply” on their scholarships page."
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((application) => (
              <ApplicationItem key={application.id} application={application} />
            ))}
          </ul>
        )}
      </section>

      {/* Scholars after the award (checklist F3) */}
      {scholars.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight">
            Scholars
            <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
              {scholars.length}
            </span>
          </h2>
          <p className="mb-3 mt-0.5 text-base text-muted-foreground">
            Awarded students checked against the grade and conduct requirements they must keep, on their latest verified
            grades.{atRisk > 0 ? ` ${atRisk} may lose the scholarship; they are listed first.` : ""}
          </p>
          <ul className="space-y-2">
            {scholars.map(({ application, retention }) => (
              <li key={application.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/staff/students/${application.students!.id}`}
                    className="text-lg font-semibold text-tup-maroon-700 underline-offset-2 hover:underline"
                  >
                    {application.students!.first_name} {application.students!.last_name}
                  </Link>
                  <span className="whitespace-nowrap font-mono text-sm text-muted-foreground">
                    {application.students!.student_number}
                  </span>
                  <ToneBadge label={RETENTION_META[retention.status].label} tone={RETENTION_META[retention.status].tone} />
                </div>
                <p className="text-base font-medium">{application.scholarships?.name ?? "Scholarship"}</p>
                <p className="mt-1 text-base text-muted-foreground">
                  {retention.summary}
                  {gradesTerm.get(application.students!.id)
                    ? ` GWA from ${gradesTerm.get(application.students!.id)}.`
                    : " No verified rating slip on file yet."}
                </p>
                {retention.failing.length > 0 && (
                  <ul className="ml-5 mt-1 list-disc text-base">
                    {retention.failing.map((f) => (
                      <li key={f.description}>
                        {f.description}: now <strong>{f.actual}</strong>
                      </li>
                    ))}
                  </ul>
                )}
                {retention.status === "at_risk" && retention.unchecked.length > 0 && (
                  <p className="mt-1 text-base text-muted-foreground">
                    Not checked yet, for want of verified grades: {retention.unchecked.join("; ")}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The catalogue: reference, so folded. */}
      <details className="group rounded-xl border border-border bg-card" open={scholarships.length === 0}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          Programs
          <span className="font-normal text-muted-foreground">
            ({active.length} active of {scholarships.length})
          </span>
        </summary>
        <div className="border-t border-border p-4">
          {scholarships.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No scholarships in the catalogue"
              description="Programs and their criteria are added by the administrator. Without criteria, the student-side eligibility check has nothing to compare against."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {scholarships.map((scholarship) => {
                const slotsLeft =
                  scholarship.slots_available != null
                    ? Math.max(scholarship.slots_available - scholarship.slots_filled, 0)
                    : null;

                return (
                  <div key={scholarship.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold">{scholarship.name}</p>
                        <p className="text-base text-muted-foreground">
                          {scholarship.sponsor_name} · {FUNDING_TYPE_LABELS[scholarship.funding_type] ?? scholarship.funding_type}
                        </p>
                      </div>
                      <ToneBadge
                        label={scholarship.is_active ? "Active" : "Inactive"}
                        tone={scholarship.is_active ? "success" : "neutral"}
                      />
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-base">
                      <Meta label="Slots">
                        {slotsLeft == null ? "Unlimited" : `${slotsLeft} left of ${scholarship.slots_available}`}
                      </Meta>
                      <Meta label="Criteria">{(scholarship.scholarship_criteria ?? []).length}</Meta>
                      <Meta label="Requirements">{(scholarship.scholarship_requirements ?? []).length}</Meta>
                      <Meta label="Closes">
                        {scholarship.application_closes ? formatManilaMonthDay(scholarship.application_closes) : "No deadline"}
                      </Meta>
                    </dl>

                    {(scholarship.scholarship_criteria ?? []).length === 0 && (
                      <p className="mt-2 rounded-md bg-amber-50 p-2 text-base text-amber-900">
                        No criteria set, so every student sees &ldquo;more info needed&rdquo; for this program.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>

      {/* Decided applications: done work, folded. */}
      {decided.length > 0 && (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            Decided applications
            <span className="font-normal text-muted-foreground">
              ({decided.length}, endorsed, sent, awarded, declined or withdrawn)
            </span>
          </summary>
          <ul className="space-y-3 border-t border-border p-4">
            {decided.map((application) => (
              <ApplicationItem key={application.id} application={application} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ApplicationItem({ application }: { application: ApplicationRow }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-base">
          {application.students ? (
            <Link
              href={`/staff/students/${application.students.id}`}
              className="text-lg font-semibold text-tup-maroon-700 underline-offset-2 hover:underline"
            >
              {application.students.first_name} {application.students.last_name}
            </Link>
          ) : (
            <span className="text-lg font-semibold">Unknown student</span>
          )}
          {application.students?.student_number && (
            <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
              {application.students.student_number}
            </span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium">{application.scholarships?.name ?? "Scholarship"}</span>
          <ToneBadge
            label={APPLICATION_STATUS_LABELS[application.status] ?? application.status}
            tone={STATUS_TONE[application.status] ?? "neutral"}
          />
          <span className="text-sm text-muted-foreground">School year {application.school_year}</span>
        </p>
        {(application.endorsement_notes || application.rejection_reason) && (
          <p className="text-base text-muted-foreground">{application.rejection_reason ?? application.endorsement_notes}</p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <ApplicationStatusForm applicationId={application.id} currentStatus={application.status} />
      </div>
    </li>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
