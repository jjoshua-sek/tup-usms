import type { Metadata } from "next";
import Link from "next/link";
import { Award, HandHeart, Trophy, Users } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { ApplicationStatusForm } from "@/components/scholarships/application-status-form";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDay } from "@/lib/utils/time";
import type { Scholarship } from "@/types/osa";

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
        "id, status, school_year, semester, created_at, endorsement_notes, rejection_reason, students(id, first_name, last_name, student_number, program), scholarships(name, sponsor_name)",
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
  const pending = applications.filter((application) =>
    ["interest_declared", "documents_pending", "documents_complete", "under_review"].includes(
      application.status,
    ),
  );
  const awarded = applications.filter((application) => application.status === "awarded");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Scholarships" }]}
        title="Scholarships"
        description="The catalogue students are matched against, and the queue of students who intend to apply."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Active programs" value={active.length} icon={Award} />
        <StatsCard
          label="In the queue"
          value={pending.length}
          icon={HandHeart}
          iconTone={pending.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard label="Awarded" value={awarded.length} icon={Trophy} iconTone="success" />
        <StatsCard
          label="Total slots"
          value={active.reduce((sum, s) => sum + (s.slots_available ?? 0), 0)}
          icon={Users}
        />
      </div>

      {/* Catalogue */}
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Programs</h2>
        {scholarships.length === 0 ? (
          <EmptyState
            icon={Award}
            title="No scholarships in the catalogue"
            description="Seed them through the database for now — with no criteria rows, the student-side eligibility check has nothing to evaluate."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {scholarships.map((scholarship) => {
              const slotsLeft =
                scholarship.slots_available != null
                  ? Math.max(scholarship.slots_available - scholarship.slots_filled, 0)
                  : null;

              return (
                <div
                  key={scholarship.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-[15px] font-semibold">
                        {scholarship.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {scholarship.sponsor_name} · {scholarship.funding_type}
                      </p>
                    </div>
                    <ToneBadge
                      label={scholarship.is_active ? "Active" : "Inactive"}
                      tone={scholarship.is_active ? "success" : "neutral"}
                    />
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <Meta label="Slots">
                      {slotsLeft == null
                        ? "Unlimited"
                        : `${slotsLeft} left of ${scholarship.slots_available}`}
                    </Meta>
                    <Meta label="Criteria">
                      {(scholarship.scholarship_criteria ?? []).length}
                    </Meta>
                    <Meta label="Requirements">
                      {(scholarship.scholarship_requirements ?? []).length}
                    </Meta>
                    <Meta label="Closes">
                      {formatManilaMonthDay(scholarship.application_closes)}
                    </Meta>
                  </dl>

                  {(scholarship.scholarship_criteria ?? []).length === 0 && (
                    <p className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">
                      No criteria defined — every student will see &ldquo;more info
                      needed&rdquo; for this program.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Applications */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
          Student queue
        </h2>
        {applications.length === 0 ? (
          <EmptyState
            icon={HandHeart}
            title="Nobody in the queue"
            description="Students land here when they press “I intend to apply” on their scholarships page."
          />
        ) : (
          <ul className="space-y-3">
            {applications.map((application) => (
              <li
                key={application.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold">
                        {application.scholarships?.name ?? "Scholarship"}
                      </p>
                      <ToneBadge
                        label={application.status.replace(/_/g, " ")}
                        tone={STATUS_TONE[application.status] ?? "neutral"}
                      />
                    </div>
                    <p className="mt-1 text-[13px]">
                      {application.students ? (
                        <Link
                          href={`/staff/students/${application.students.id}`}
                          className="text-tup-maroon-600 underline-offset-2 hover:underline"
                        >
                          {application.students.first_name} {application.students.last_name}
                        </Link>
                      ) : (
                        "Unknown student"
                      )}
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        {application.students?.student_number}
                      </span>
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {application.school_year}
                      </span>
                    </p>
                    {(application.endorsement_notes || application.rejection_reason) && (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {application.rejection_reason ?? application.endorsement_notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <ApplicationStatusForm
                    applicationId={application.id}
                    currentStatus={application.status}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
