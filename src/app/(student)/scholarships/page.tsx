import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Award,
  Check,
  CircleHelp,
  ExternalLink,
  Mail,
  Minus,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { DeclareInterestButton } from "@/components/scholarships/declare-interest-button";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { buildStudentEligibilityProfile } from "@/lib/scholarships/build-profile";
import {
  ELIGIBILITY_STATUS_META,
  evaluateAllScholarships,
  type CriterionResult,
  type ScholarshipCriterion,
  type ScholarshipRequirement,
} from "@/lib/scholarships/evaluate-eligibility";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import type { Scholarship } from "@/types/osa";

export const metadata: Metadata = {
  title: "Scholarships",
};

const STATUS_TONE: Record<string, Tone> = {
  eligible: "success",
  partially_eligible: "warning",
  indeterminate: "neutral",
  not_eligible: "danger",
};

interface ScholarshipWithRules extends Scholarship {
  scholarship_criteria: ScholarshipCriterion[] | null;
  scholarship_requirements: ScholarshipRequirement[] | null;
}

/**
 * Scholarship eligibility (requirement #3).
 *
 * The system tells a student which scholarships they qualify for and what
 * each one needs — it never applies on their behalf. Every card ends with
 * where to actually file.
 */
export default async function ScholarshipsPage() {
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

  const [{ data: scholarshipRows }, { data: applicationRows }, profile] = await Promise.all([
    db
      .from("scholarships")
      .select(
        "*, scholarship_criteria(*), scholarship_requirements(id, requirement_name, description, document_type, is_mandatory, obtained_from, display_order)",
      )
      .eq("is_active", true)
      .order("name", { ascending: true }),
    db
      .from("scholarship_applications")
      .select("scholarship_id, status")
      .eq("student_id", student.id),
    buildStudentEligibilityProfile(db, student.id),
  ]);

  const scholarships = (scholarshipRows as ScholarshipWithRules[] | null) ?? [];
  const applications =
    (applicationRows as Array<{ scholarship_id: string; status: string }> | null) ?? [];
  const declaredIds = new Set(applications.map((a) => a.scholarship_id));

  const results = evaluateAllScholarships(
    scholarships.map((s) => ({ id: s.id, criteria: s.scholarship_criteria ?? [] })),
    profile,
  );
  const byId = new Map(scholarships.map((s) => [s.id, s]));

  const eligibleCount = results.filter((r) => r.status === "eligible").length;
  const needsDataCount = results.filter((r) => r.status === "indeterminate").length;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Scholarships" }]}
        title="Scholarships"
        description="What you currently qualify for, what each one requires, and where to file it."
      />

      {/* Honest framing up front */}
      <div className="mb-5 rounded-xl border border-border bg-card p-4">
        <p className="text-[13px] leading-relaxed">
          <strong>{eligibleCount}</strong> scholarship
          {eligibleCount === 1 ? "" : "s"} match your record right now
          {needsDataCount > 0 && (
            <>
              , and <strong>{needsDataCount}</strong> can&apos;t be checked until your
              grades are on file
            </>
          )}
          .{" "}
          <span className="text-muted-foreground">
            This portal does not submit applications for you — it tells you what you
            qualify for and what to bring.
          </span>
        </p>

        {needsDataCount > 0 && (
          <Link
            href="/records"
            className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Upload your rating slip
          </Link>
        )}
      </div>

      {scholarships.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No scholarships listed yet"
          description="The OSA hasn't published any scholarship programs in the system. Check the OSA bulletin board in the meantime."
        />
      ) : (
        <ul className="space-y-4">
          {results.map((result) => {
            const scholarship = byId.get(result.scholarship_id);
            if (!scholarship) return null;

            const meta = ELIGIBILITY_STATUS_META[result.status];
            const requirements = [...(scholarship.scholarship_requirements ?? [])].sort(
              (a, b) => a.display_order - b.display_order,
            );

            return (
              <li
                key={scholarship.id}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold">
                        {scholarship.name}
                      </h2>
                      <ToneBadge label={meta.label} tone={STATUS_TONE[result.status]} />
                      {scholarship.is_masterlist_based && (
                        <ToneBadge label="By masterlist" tone="info" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {scholarship.sponsor_name} · {scholarship.funding_type}
                      {scholarship.slots_available
                        ? ` · ${Math.max(
                            scholarship.slots_available - scholarship.slots_filled,
                            0,
                          )} of ${scholarship.slots_available} slots left`
                        : ""}
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed">{result.summary}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      {Math.round(result.matchPercentage)}%
                    </span>
                    <DeclareInterestButton
                      scholarshipId={scholarship.id}
                      alreadyDeclared={declaredIds.has(scholarship.id)}
                    />
                  </div>
                </div>

                <div className="grid gap-5 p-5 md:grid-cols-2">
                  {/* Criteria */}
                  <div>
                    <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Eligibility check
                    </h3>
                    <ul className="space-y-1.5">
                      {[...result.failed, ...result.indeterminate, ...result.passed].map(
                        (criterion) => (
                          <CriterionLine key={criterion.criterion_id} criterion={criterion} />
                        ),
                      )}
                    </ul>
                  </div>

                  {/* Requirements */}
                  <div>
                    <h3 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      What to prepare
                    </h3>
                    {requirements.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        Requirements not published yet — ask at the OSA window.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {requirements.map((requirement) => (
                          <li key={requirement.id} className="text-[13px]">
                            <span className="font-medium">
                              {requirement.requirement_name}
                            </span>
                            {!requirement.is_mandatory && (
                              <span className="text-muted-foreground"> (optional)</span>
                            )}
                            {requirement.obtained_from && (
                              <span className="block text-[11px] text-muted-foreground">
                                Get it from: {requirement.obtained_from}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Where to file */}
                    <div className="mt-4 space-y-1 border-t border-border pt-3 text-[12px]">
                      {scholarship.benefit_summary && (
                        <p>
                          <strong>Benefit:</strong> {scholarship.benefit_summary}
                        </p>
                      )}
                      {scholarship.application_closes && (
                        <p>
                          <strong>Deadline:</strong>{" "}
                          {new Date(scholarship.application_closes).toLocaleDateString(
                            "en-PH",
                            { month: "long", day: "numeric", year: "numeric" },
                          )}
                        </p>
                      )}
                      {scholarship.contact_person && (
                        <p className="text-muted-foreground">
                          Contact: {scholarship.contact_person}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3 pt-1">
                        {scholarship.contact_email && (
                          <a
                            href={`mailto:${scholarship.contact_email}`}
                            className="inline-flex items-center gap-1 text-tup-maroon-600 underline-offset-2 hover:underline"
                          >
                            <Mail className="h-3 w-3" />
                            {scholarship.contact_email}
                          </a>
                        )}
                        {scholarship.external_url && (
                          <a
                            href={scholarship.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-tup-maroon-600 underline-offset-2 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Sponsor&apos;s page
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CriterionLine({ criterion }: { criterion: CriterionResult }) {
  const Icon = criterion.passed === true ? Check : criterion.passed === false ? X : CircleHelp;
  const tone =
    criterion.passed === true
      ? "text-emerald-600"
      : criterion.passed === false
        ? "text-red-600"
        : "text-muted-foreground";

  return (
    <li className="flex items-start gap-2 text-[13px]">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="min-w-0">
        {criterion.human_description}
        {criterion.passed !== true && (
          <span className="block text-[11px] text-muted-foreground">
            {criterion.hint ?? `Yours: ${criterion.actual}`}
          </span>
        )}
      </span>
      {!criterion.is_mandatory && (
        <Minus className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" aria-label="bonus criterion" />
      )}
    </li>
  );
}
