/**
 * Logistic regression inference for the at-risk Early Warning System.
 *
 * WHY LOGISTIC REGRESSION
 * Each coefficient IS the feature importance. When OSA asks "why is this
 * student flagged," the answer is an exact signed contribution per feature
 * — no post-hoc approximation such as SHAP or LIME. For a system that
 * triggers real interventions on real students, an auditable linear model
 * is more defensible than a marginally more accurate opaque one.
 *
 * WHERE THE WEIGHTS COME FROM
 * Trained offline (Python/scikit-learn) on historical OSA outcome data,
 * then imported into `risk_model_versions`. This file only does inference.
 * The shipped v1.0 weights are literature priors, not institutionally
 * trained — see the migration's training_notes.
 *
 * PHILIPPINE GRADING CONVENTION
 * 1.00 is the HIGHEST mark and 5.00 is failing. Every calculation here
 * respects that inversion. A rising GWA number means DECLINING performance.
 */

import {
  RISK_FEATURE_KEYS,
  FEATURE_LABELS,
  type RawRiskInputs,
  type NormalizedFeatures,
  type FeatureContribution,
  type RiskModel,
  type RiskAssessmentResult,
  type RiskFeatureKey,
  type RiskTier,
} from "./types";

// ============================================================
// Math helpers
// ============================================================

/** Standard logistic function. */
function sigmoid(z: number): number {
  // Clamp to avoid Infinity in Math.exp for extreme logits.
  if (z < -40) return 0;
  if (z > 40) return 1;
  return 1 / (1 + Math.exp(-z));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps an unbounded non-negative count onto [0, 1) with diminishing returns.
 * Used for counts where the first occurrence matters far more than the
 * tenth: one open case is a meaningful signal, the difference between
 * eight and nine is not.
 */
function saturate(value: number, scale: number): number {
  if (value <= 0) return 0;
  return value / (value + scale);
}

// ============================================================
// Neutral values for missing data
// ============================================================
/**
 * When a feature's source data is absent we substitute a neutral value
 * rather than 0. Substituting 0 would mean "perfect attendance, no
 * failures, top grades" — actively misleading, because a student who has
 * uploaded nothing would score as the safest student in the cohort.
 *
 * These neutral values approximate a median student, so an imputed feature
 * neither rescues nor condemns. The imputation is recorded per feature and
 * reflected in dataCompleteness so staff can see the score is partial.
 */
const NEUTRAL: Record<RiskFeatureKey, number> = {
  gwa_risk: 0.44, // ≈ GWA 2.75, a middling mark
  gwa_delta: 0.5, // no observed change
  failure_ratio: 0.1,
  attendance_deficit: 0.15,
  violation_severity: 0, // absence of violations is a genuine observation
  open_cases: 0, // likewise
  financial_stress: 0, // profile fields are usually present
  probationary: 0,
};

// ============================================================
// Feature normalization
// ============================================================

/**
 * Converts raw inputs into the [0, 1] feature vector the model expects.
 * Also reports which features had to be imputed.
 */
export function normalizeFeatures(raw: RawRiskInputs): {
  features: NormalizedFeatures;
  imputed: Set<RiskFeatureKey>;
} {
  const imputed = new Set<RiskFeatureKey>();

  // ---- gwa_risk ----
  // Philippine scale 1.00–5.00 mapped linearly onto 0–1, where 1.00 → 0
  // (no risk) and 5.00 → 1 (maximum risk).
  let gwa_risk: number;
  if (raw.current_gwa == null) {
    gwa_risk = NEUTRAL.gwa_risk;
    imputed.add("gwa_risk");
  } else {
    gwa_risk = clamp((raw.current_gwa - 1.0) / 4.0, 0, 1);
  }

  // ---- gwa_delta ----
  // Positive delta = GWA number went up = performance declined.
  // Mapped so 0.5 is "no change", 1.0 is a full-point decline, 0 is a
  // full-point improvement.
  let gwa_delta: number;
  if (raw.gwa_delta == null) {
    gwa_delta = NEUTRAL.gwa_delta;
    imputed.add("gwa_delta");
  } else {
    gwa_delta = clamp((raw.gwa_delta + 1.0) / 2.0, 0, 1);
  }

  // ---- failure_ratio ----
  let failure_ratio: number;
  if (raw.failure_ratio == null) {
    failure_ratio = NEUTRAL.failure_ratio;
    imputed.add("failure_ratio");
  } else {
    failure_ratio = clamp(raw.failure_ratio, 0, 1);
  }

  // ---- attendance_deficit ----
  let attendance_deficit: number;
  if (raw.current_attendance_rate == null) {
    attendance_deficit = NEUTRAL.attendance_deficit;
    imputed.add("attendance_deficit");
  } else {
    attendance_deficit = clamp(1 - raw.current_attendance_rate, 0, 1);
  }

  // ---- violation_severity ----
  // Weighted by classification, then decayed by recency: a major offense
  // from three years ago is a weaker present-tense signal than a minor one
  // from last month. Half-life is roughly one academic year.
  const minor = raw.minor_violation_count ?? 0;
  const major = raw.major_violation_count ?? 0;
  const rawSeverity = minor * 1 + major * 3;

  let recencyMultiplier = 1;
  if (raw.days_since_last_violation != null && rawSeverity > 0) {
    // exp(-days / 365) → 1.0 today, ~0.37 after a year, ~0.14 after two.
    recencyMultiplier = Math.exp(-raw.days_since_last_violation / 365);
    // Floor at 0.2 so a serious past offense never decays to nothing.
    recencyMultiplier = Math.max(0.2, recencyMultiplier);
  }
  const violation_severity = saturate(rawSeverity * recencyMultiplier, 10);

  // ---- open_cases ----
  const open_cases = saturate(raw.open_case_count ?? 0, 3);

  // ---- financial_stress ----
  // Binary composite. Listahanan listing is a DSWD poverty indicator;
  // self-supporting and working students carry documented elevated
  // attrition risk in the retention literature.
  const stressIndicators =
    (raw.is_listahan ? 1 : 0) +
    (raw.financial_support === "Self-supporting" ? 1 : 0) +
    (raw.financial_support === "Working Student" ? 1 : 0);
  const financial_stress = stressIndicators > 0 ? 1 : 0;

  // ---- probationary ----
  const status = (raw.scholastic_status ?? "").toLowerCase();
  const probationary =
    status.includes("probation") || status.includes("warning") ? 1 : 0;

  return {
    features: {
      gwa_risk,
      gwa_delta,
      failure_ratio,
      attendance_deficit,
      violation_severity,
      open_cases,
      financial_stress,
      probationary,
    },
    imputed,
  };
}

// ============================================================
// Explanations
// ============================================================

/**
 * Plain-language description of what a feature value means, written for an
 * OSA officer who is about to meet the student — not for a data scientist.
 */
function explainFeature(
  key: RiskFeatureKey,
  raw: RawRiskInputs,
  normalized: number,
  wasImputed: boolean
): { explanation: string; rawValue: number | string | null } {
  if (wasImputed) {
    return {
      explanation: "No data on file. A neutral value was used.",
      rawValue: null,
    };
  }

  switch (key) {
    case "gwa_risk": {
      const gwa = raw.current_gwa!;
      let verdict: string;
      if (gwa <= 1.5) verdict = "excellent standing";
      else if (gwa <= 2.0) verdict = "good standing";
      else if (gwa <= 2.5) verdict = "satisfactory standing";
      else if (gwa <= 3.0) verdict = "marginal standing";
      else verdict = "at risk of academic failure";
      return { explanation: `GWA of ${gwa.toFixed(2)} — ${verdict}.`, rawValue: gwa };
    }

    case "gwa_delta": {
      const delta = raw.gwa_delta!;
      if (Math.abs(delta) < 0.05) {
        return { explanation: "Grades are stable term over term.", rawValue: delta };
      }
      // Remember: a POSITIVE delta means the number went up, which is worse.
      return delta > 0
        ? {
            explanation: `Grades declined by ${delta.toFixed(2)} points since last term.`,
            rawValue: delta,
          }
        : {
            explanation: `Grades improved by ${Math.abs(delta).toFixed(2)} points since last term.`,
            rawValue: delta,
          };
    }

    case "failure_ratio": {
      const ratio = raw.failure_ratio!;
      const failed = raw.current_units_failed ?? 0;
      const enrolled = raw.current_units_enrolled ?? 0;
      if (ratio === 0) {
        return { explanation: "No failed units this term.", rawValue: 0 };
      }
      return {
        explanation: `Failed ${failed} of ${enrolled} enrolled units (${Math.round(ratio * 100)}%).`,
        rawValue: ratio,
      };
    }

    case "attendance_deficit": {
      const rate = raw.current_attendance_rate!;
      const pct = Math.round(rate * 100);
      if (rate >= 0.9) {
        return { explanation: `Attendance at ${pct}% — consistent.`, rawValue: rate };
      }
      if (rate >= 0.75) {
        return { explanation: `Attendance at ${pct}% — some absences.`, rawValue: rate };
      }
      return {
        explanation: `Attendance at ${pct}% — frequent absences.`,
        rawValue: rate,
      };
    }

    case "violation_severity": {
      const minor = raw.minor_violation_count ?? 0;
      const major = raw.major_violation_count ?? 0;
      if (minor === 0 && major === 0) {
        return { explanation: "No disciplinary record.", rawValue: 0 };
      }
      const parts: string[] = [];
      if (major > 0) parts.push(`${major} major`);
      if (minor > 0) parts.push(`${minor} minor`);
      const recency =
        raw.days_since_last_violation != null
          ? ` Most recent was ${raw.days_since_last_violation} days ago.`
          : "";
      return {
        explanation: `${parts.join(", ")} violation${major + minor === 1 ? "" : "s"} on record.${recency}`,
        rawValue: `${major} major / ${minor} minor`,
      };
    }

    case "open_cases": {
      const count = raw.open_case_count ?? 0;
      return count === 0
        ? { explanation: "No open disciplinary cases.", rawValue: 0 }
        : {
            explanation: `${count} unresolved disciplinary case${count === 1 ? "" : "s"}.`,
            rawValue: count,
          };
    }

    case "financial_stress": {
      if (normalized === 0) {
        return { explanation: "No financial stress indicators.", rawValue: "none" };
      }
      const flags: string[] = [];
      if (raw.is_listahan) flags.push("Listahanan-listed");
      if (raw.financial_support === "Self-supporting") flags.push("self-supporting");
      if (raw.financial_support === "Working Student") flags.push("working student");
      return {
        explanation: `${flags.join(", ")}. May benefit from a financial aid referral.`,
        rawValue: flags.join(", "),
      };
    }

    case "probationary": {
      const s = raw.scholastic_status ?? "Regular";
      return normalized === 1
        ? { explanation: `Scholastic status: ${s}.`, rawValue: s }
        : { explanation: `Scholastic status: ${s} — in good standing.`, rawValue: s };
    }
  }
}

// ============================================================
// Main scoring function
// ============================================================

/**
 * Runs inference and produces a fully explained assessment.
 *
 * @param raw   Row from the `student_risk_features` view.
 * @param model Active row from `risk_model_versions`.
 */
export function scoreStudent(
  raw: RawRiskInputs,
  model: RiskModel
): RiskAssessmentResult {
  const { features, imputed } = normalizeFeatures(raw);

  // ---- Compute the logit ----
  let logit = model.intercept;
  const rawContributions: Array<{ key: RiskFeatureKey; contribution: number }> = [];

  for (const key of RISK_FEATURE_KEYS) {
    const weight = model.coefficients[key] ?? 0;
    const value = features[key];
    const contribution = weight * value;
    logit += contribution;
    rawContributions.push({ key, contribution });
  }

  const risk_score = sigmoid(logit);

  // ---- Relative importance, for sorting and display ----
  const totalAbs = rawContributions.reduce(
    (sum, c) => sum + Math.abs(c.contribution),
    0
  );

  const contributions: FeatureContribution[] = rawContributions.map(
    ({ key, contribution }) => {
      const wasImputed = imputed.has(key);
      const { explanation, rawValue } = explainFeature(
        key,
        raw,
        features[key],
        wasImputed
      );

      return {
        feature: key,
        label: FEATURE_LABELS[key],
        rawValue,
        normalizedValue: features[key],
        weight: model.coefficients[key] ?? 0,
        contribution,
        relativeImportance: totalAbs > 0 ? Math.abs(contribution) / totalAbs : 0,
        imputed: wasImputed,
        explanation,
      };
    }
  );

  // ---- Tier assignment ----
  let risk_tier: RiskTier;
  if (risk_score >= model.threshold_critical) risk_tier = "critical";
  else if (risk_score >= model.threshold_high) risk_tier = "high";
  else if (risk_score >= model.threshold_moderate) risk_tier = "moderate";
  else risk_tier = "low";

  // ---- Split drivers into risk-increasing and protective ----
  // A contribution is only meaningful above a small epsilon; near-zero
  // contributions are noise and would clutter the staff view.
  const EPSILON = 0.01;

  const topRiskFactors = contributions
    .filter((c) => c.contribution > EPSILON && !c.imputed)
    .sort((a, b) => b.contribution - a.contribution);

  const protectiveFactors = contributions
    .filter((c) => c.contribution < -EPSILON && !c.imputed)
    .sort((a, b) => a.contribution - b.contribution);

  // ---- Data completeness ----
  const dataCompleteness =
    raw.data_completeness ??
    (RISK_FEATURE_KEYS.length - imputed.size) / RISK_FEATURE_KEYS.length;

  return {
    student_id: raw.student_id,
    model_version_id: model.id,
    risk_score,
    risk_tier,
    logit,
    normalizedFeatures: features,
    contributions,
    topRiskFactors,
    protectiveFactors,
    dataCompleteness,
    // Below 50% completeness the score is more artifact than signal.
    lowConfidence: dataCompleteness < 0.5,
  };
}

// ============================================================
// Presentation helpers
// ============================================================

export const RISK_TIER_META: Record<
  RiskTier,
  { label: string; description: string; action: string }
> = {
  low: {
    label: "Low",
    description: "No significant risk indicators.",
    action: "Routine monitoring.",
  },
  moderate: {
    label: "Moderate",
    description: "Some indicators warrant attention.",
    action: "Consider a check-in within the term.",
  },
  high: {
    label: "High",
    description: "Multiple indicators suggest elevated risk.",
    action: "Schedule a guidance session this month.",
  },
  critical: {
    label: "Critical",
    description: "Strong indicators of imminent academic difficulty.",
    action: "Immediate outreach recommended.",
  },
};

/**
 * Suggests intervention types based on which features dominate the score.
 * Deliberately rule-based rather than model-driven: the mapping from
 * "what is wrong" to "what OSA should do about it" is institutional
 * policy, not something to be learned from data.
 */
export function suggestInterventions(
  result: RiskAssessmentResult
): Array<{ type: string; reason: string; priority: "normal" | "high" | "urgent" }> {
  const suggestions: Array<{
    type: string;
    reason: string;
    priority: "normal" | "high" | "urgent";
  }> = [];

  const byKey = new Map(result.contributions.map((c) => [c.feature, c]));
  const basePriority =
    result.risk_tier === "critical"
      ? "urgent"
      : result.risk_tier === "high"
        ? "high"
        : "normal";

  const gwa = byKey.get("gwa_risk");
  const delta = byKey.get("gwa_delta");
  if ((gwa && gwa.normalizedValue > 0.5) || (delta && delta.normalizedValue > 0.6)) {
    suggestions.push({
      type: "academic_advising",
      reason: "Academic performance is declining or below threshold.",
      priority: basePriority,
    });
  }

  const failures = byKey.get("failure_ratio");
  if (failures && failures.normalizedValue > 0.2) {
    suggestions.push({
      type: "tutoring_referral",
      reason: "Significant proportion of units failed this term.",
      priority: basePriority,
    });
  }

  const attendance = byKey.get("attendance_deficit");
  if (attendance && attendance.normalizedValue > 0.25) {
    suggestions.push({
      type: "wellness_check",
      reason: "Attendance pattern suggests a possible underlying issue.",
      priority: basePriority,
    });
  }

  const financial = byKey.get("financial_stress");
  if (financial && financial.normalizedValue > 0) {
    suggestions.push({
      type: "financial_aid_referral",
      reason: "Financial stress indicators present; check scholarship eligibility.",
      priority: "normal",
    });
  }

  const violations = byKey.get("violation_severity");
  const openCases = byKey.get("open_cases");
  if (
    (violations && violations.normalizedValue > 0.2) ||
    (openCases && openCases.normalizedValue > 0)
  ) {
    suggestions.push({
      type: "disciplinary_followup",
      reason: "Disciplinary history or unresolved case requires follow-through.",
      priority: basePriority,
    });
  }

  // Any high or critical student gets a guidance referral regardless of
  // which specific features drove the score — the conversation itself is
  // the intervention.
  if (result.risk_tier === "high" || result.risk_tier === "critical") {
    suggestions.unshift({
      type: "guidance_referral",
      reason: `Overall risk assessed as ${result.risk_tier}.`,
      priority: basePriority,
    });
  }

  return suggestions;
}
