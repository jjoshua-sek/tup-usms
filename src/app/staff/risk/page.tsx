import type { Metadata } from "next";
import Link from "next/link";
import { PulseIcon as Activity, WarningIcon as AlertTriangle, CaretDownIcon as ChevronDown } from "@phosphor-icons/react/ssr";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { InterventionForm } from "@/components/risk/intervention-form";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { ActivateModelButton } from "@/components/risk/activate-model-button";
import {
  featuresToInputs,
  loadActiveRiskModel,
  loadRiskFeatures,
  loadRiskModelVersions,
} from "@/lib/risk/load";
import { followUpTypeLabel } from "@/lib/risk/follow-up-labels";
import { RISK_TIER_META, scoreStudent, suggestInterventions } from "@/lib/risk/score";
import type { RiskTier } from "@/lib/risk/types";
import { canChooseRiskModel, summarizeModelVersion } from "@/lib/risk/versions";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "At-risk students",
};

const TIER_TONE: Record<RiskTier, Tone> = {
  low: "success",
  moderate: "info",
  high: "warning",
  critical: "danger",
};

const TIERS: Array<RiskTier | "all"> = ["critical", "high", "moderate", "low", "all"];

const COUNT = new Intl.NumberFormat("en-PH");
const formatFigure = (value: number | null) => (value == null ? "Not recorded" : value.toFixed(3));
const formatPercent = (value: number | null) => (value == null ? "Not recorded" : `${Math.round(value * 100)}%`);

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
        title="At-risk students"
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

  const [model, features, versionRows] = await Promise.all([
    loadActiveRiskModel(db),
    loadRiskFeatures(db, { limit: 500 }),
    loadRiskModelVersions(db),
  ]);
  const versions = versionRows.map(summarizeModelVersion);
  const activeVersion = versions.find((version) => version.active);
  const canChoose = canChooseRiskModel(staff.role);

  const versionsPanel =
    versions.length > 0 ? (
      <details className="group mt-6 rounded-xl border border-border bg-card" open={!model}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          Model versions
          <span className="font-normal text-muted-foreground">(which model scores the list, and how well each one tested)</span>
        </summary>
        <section className="border-t border-border p-5">
        <p className="text-base text-muted-foreground">
          Figures are from students held out of training: AUC is how well the model ranks
          at-risk students above the rest (0.5 is chance, 1 is perfect); precision and recall
          are at the moderate cut point.
          {canChoose ? " Switching rescores every student at once." : ""}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-base">
            <thead className="text-sm text-muted-foreground font-medium">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-semibold">Version</th>
                <th className="py-2 pr-3 font-semibold">Weights from</th>
                <th className="py-2 pr-3 text-right font-semibold">AUC</th>
                <th className="py-2 pr-3 text-right font-semibold">Precision</th>
                <th className="py-2 pr-3 text-right font-semibold">Recall</th>
                <th className="py-2 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2.5 pr-3">
                    <span className="font-mono font-medium">{version.label}</span>
                    {version.trainedAt && (
                      <span className="block text-sm text-muted-foreground">
                        {version.trainedOn
                          ? `${COUNT.format(version.trainedOn)} students · `
                          : ""}
                        {version.trainedAt}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {version.source}
                    {version.caveat && (
                      <span className="block text-sm text-muted-foreground">{version.caveat}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{formatFigure(version.auc)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{formatPercent(version.precision)}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{formatPercent(version.recall)}</td>
                  <td className="py-2.5 text-right">
                    {version.active ? (
                      <ToneBadge label="In use" tone="success" />
                    ) : canChoose ? (
                      <ActivateModelButton versionId={version.id} label={version.label} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>
      </details>
    ) : null;

  if (!model) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "At-risk students" }]}
          title="At-risk students"
        />
        <EmptyState
          icon={AlertTriangle}
          title="No risk model is switched on"
          description={
            canChoose
              ? "So no student can be scored. Switch one on under Model versions below."
              : "So no student can be scored. Ask the OSA head or the administrator to switch one on."
          }
        />
        {versionsPanel}
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
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "At-risk students" }]}
        title="At-risk students"
        description="Students the early warning model suggests checking on first, highest score first. Each card says why, and what to offer."
      />

      {lowConfidence > 0 && (
        <p className="mb-4 max-w-prose text-base text-muted-foreground">
          {lowConfidence} {lowConfidence === 1 ? "score is" : "scores are"} marked <strong>Low confidence</strong>: too
          few verified documents to trust {lowConfidence === 1 ? "it" : "them"} yet.
        </p>
      )}

      {/* The tabs carry the counts, so no separate number tiles. */}
      <nav aria-label="Which students" className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {TIERS.map((option) => {
          const active = activeTier === option;
          const count = option === "all" ? scored.length : counts[option];
          return (
            <Link
              key={option}
              href={option === "all" ? "/staff/risk" : `/staff/risk?tier=${option}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-base font-medium transition-colors",
                active
                  ? "border-tup-maroon-600 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "all" ? "All" : RISK_TIER_META[option].label}
              <span
                className={cn(
                  "rounded-full px-2 text-sm tabular-nums",
                  active
                    ? "bg-tup-maroon-600 text-white"
                    : option === "critical" && count > 0
                      ? "bg-red-100 text-red-800"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

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
                      <p className="font-display text-lg font-semibold">
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
                    <p className="text-base text-muted-foreground">
                      <span className="whitespace-nowrap font-mono text-sm">{row.student_number}</span>
                      {row.program ? ` · ${row.program}` : ""}
                      {row.year_level ? `, ${row.year_level}` : ""}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Risk score</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {Math.round(assessment.risk_score * 100)}
                      <span className="text-base text-muted-foreground">%</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {Math.round(assessment.dataCompleteness * 100)}% of the data on file
                    </p>
                  </div>
                </div>

                {/* Why — the explainable part */}
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-base font-semibold">
                      What raises the score
                    </p>
                    {assessment.topRiskFactors.length === 0 ? (
                      <p className="text-base text-muted-foreground">
                        Nothing above the neutral baseline.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {assessment.topRiskFactors.slice(0, 3).map((factor) => (
                          <li key={factor.feature} className="text-base">
                            <span className="font-medium">{factor.label}</span>
                            {factor.imputed && (
                              <span className="ml-1 text-sm text-muted-foreground">
                                (assumed: no data yet)
                              </span>
                            )}
                            <span className="block text-sm text-muted-foreground">
                              {factor.explanation}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="mb-1.5 text-base font-semibold">
                      Suggested next step
                    </p>
                    {suggestions.length === 0 ? (
                      <p className="text-base text-muted-foreground">
                        {tierMeta.action}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {suggestions.slice(0, 2).map((suggestion) => (
                          <li key={suggestion.type} className="text-base">
                            <span className="font-medium">
                              {followUpTypeLabel(suggestion.type)}
                            </span>
                            <span className="block text-sm text-muted-foreground">
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
                    className="inline-flex min-h-10 items-center px-2 text-base font-medium text-tup-maroon-700 underline-offset-2 hover:underline"
                  >
                    Open student record
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {versionsPanel}

      <p className="mt-5 max-w-prose rounded-xl border border-border bg-muted/40 p-4 text-base leading-relaxed text-muted-foreground">
        <strong className="text-foreground">On using these scores:</strong> the model in use takes its weights from{" "}
        {activeVersion?.sourceInSentence ?? "a source not recorded"}. It ranks who to check on first; it does not
        predict failure. Never quote a score to a student, and never let one stand in for a conversation.
      </p>
    </div>
  );
}
