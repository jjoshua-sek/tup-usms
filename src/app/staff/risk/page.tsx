import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, CircleHelp, TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { InterventionForm } from "@/components/risk/intervention-form";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { RISK_TIER_META, scoreStudent, suggestInterventions } from "@/lib/risk/score";
import type { RiskTier } from "@/lib/risk/types";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "At-Risk Students",
};

const TIER_TONE: Record<RiskTier, Tone> = {
  low: "success",
  moderate: "info",
  high: "warning",
  critical: "danger",
};

const TIERS: Array<RiskTier | "all"> = ["critical", "high", "moderate", "low", "all"];

/**
 * The early warning list (the ML half of the thesis).
 *
 * Scores are computed on read from the `student_risk_features` view rather
 * than served from a nightly batch, so the list always reflects the documents
 * verified this morning. Nothing is written until a staff member opens an
 * intervention — at which point the assessment behind the decision is stored
 * alongside it.
 *
 * Two deliberate constraints:
 *   - students never see these scores; they see the support that follows
 *   - a low-completeness score is labelled as such, because a student with no
 *     uploaded documents scores artificially low, not genuinely safe
 */
export default async function StaffRiskPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCounselor)) {
    return (
      <RestrictedNotice
        title="At-Risk Students"
        audience="Early warning scores are limited to OSA officers and guidance counselors. They are never shown to students."
      />
    );
  }

  const { tier } = await searchParams;
  const activeTier = (TIERS.includes((tier ?? "") as RiskTier) ? tier : "all") as
    | RiskTier
    | "all";

  const supabase = await createClient();
  const db = loose(supabase);

  const [model, features] = await Promise.all([
    loadActiveRiskModel(db),
    loadRiskFeatures(db, { limit: 500 }),
  ]);

  if (!model) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "At-Risk" }]}
          title="At-Risk Students"
        />
        <EmptyState
          icon={AlertTriangle}
          title="No active model"
          description="No row in risk_model_versions is marked active, so nothing can be scored. Promote a version (the v1.0-baseline seed ships inactive-safe) and reload."
        />
      </div>
    );
  }

  const scored = features
    .map((row) => {
      const assessment = scoreStudent(featuresToInputs(row), model);
      return { row, assessment, suggestions: suggestInterventions(assessment) };
    })
    .sort((a, b) => b.assessment.risk_score - a.assessment.risk_score);

  const counts = {
    critical: scored.filter((s) => s.assessment.risk_tier === "critical").length,
    high: scored.filter((s) => s.assessment.risk_tier === "high").length,
    moderate: scored.filter((s) => s.assessment.risk_tier === "moderate").length,
    low: scored.filter((s) => s.assessment.risk_tier === "low").length,
  };
  const lowConfidence = scored.filter((s) => s.assessment.lowConfidence).length;

  const visible =
    activeTier === "all"
      ? scored
      : scored.filter((s) => s.assessment.risk_tier === activeTier);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "At-Risk" }]}
        title="At-Risk Students"
        description={`Scored against ${model.version_label}. Every factor below is the model's own contribution, not a guess.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Critical"
          value={counts.critical}
          icon={AlertTriangle}
          iconTone={counts.critical > 0 ? "danger" : "neutral"}
          trend={RISK_TIER_META.critical.action}
        />
        <StatsCard
          label="High"
          value={counts.high}
          icon={TrendingUp}
          iconTone={counts.high > 0 ? "warn" : "neutral"}
          trend={RISK_TIER_META.high.action}
        />
        <StatsCard label="Moderate" value={counts.moderate} icon={Activity} />
        <StatsCard
          label="Low confidence"
          value={lowConfidence}
          icon={CircleHelp}
          trend="Too little data to trust the score"
          trendTone="warn"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {TIERS.map((option) => (
          <Link
            key={option}
            href={option === "all" ? "/staff/risk" : `/staff/risk?tier=${option}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium capitalize transition-colors",
              activeTier === option
                ? "border-tup-maroon-600 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No students in this tier"
          description="Scores need verified academic data. Until students upload rating slips and the OSA verifies them, most rows here will be low-confidence."
        />
      ) : (
        <ul className="space-y-3">
          {visible.map(({ row, assessment, suggestions }) => {
            const tierMeta = RISK_TIER_META[assessment.risk_tier];

            return (
              <li key={row.student_id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-[15px] font-semibold">
                        {row.first_name} {row.last_name}
                      </p>
                      <ToneBadge
                        label={tierMeta.label}
                        tone={TIER_TONE[assessment.risk_tier]}
                      />
                      {assessment.lowConfidence && (
                        <ToneBadge label="Low confidence" tone="neutral" />
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {row.student_number} · {row.program ?? "—"} · {row.year_level ?? "—"}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-mono text-2xl font-semibold tabular-nums">
                      {Math.round(assessment.risk_score * 100)}
                      <span className="text-sm text-muted-foreground">%</span>
                    </p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {Math.round(assessment.dataCompleteness * 100)}% data
                    </p>
                  </div>
                </div>

                {/* Why — the explainable part */}
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      What raises the score
                    </p>
                    {assessment.topRiskFactors.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">
                        Nothing above the neutral baseline.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {assessment.topRiskFactors.slice(0, 3).map((factor) => (
                          <li key={factor.feature} className="text-[12px]">
                            <span className="font-medium">{factor.label}</span>
                            {factor.imputed && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (assumed — no data)
                              </span>
                            )}
                            <span className="block text-[11px] text-muted-foreground">
                              {factor.explanation}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Suggested next step
                    </p>
                    {suggestions.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">
                        {tierMeta.action}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {suggestions.slice(0, 2).map((suggestion) => (
                          <li key={suggestion.type} className="text-[12px]">
                            <span className="font-medium capitalize">
                              {suggestion.type.replace(/_/g, " ")}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {suggestion.reason}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-border pt-3">
                  <InterventionForm studentId={row.student_id} suggestions={suggestions} />
                  <Link
                    href={`/staff/students/${row.student_id}`}
                    className="inline-flex items-center px-2 py-1.5 text-[12px] text-tup-maroon-600 underline-offset-2 hover:underline"
                  >
                    Open student record
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-5 rounded-xl border border-border bg-muted/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">On using these scores:</strong> the baseline
        model&apos;s weights come from retention literature, not from TUP outcome data — it
        ranks who to check on first, it does not predict failure. Never quote a score to a
        student, and never let one stand in for a conversation.
      </p>
    </div>
  );
}
