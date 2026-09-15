/**
 * Types for the Machine Learning Early Warning System.
 *
 * The feature set is defined here and mirrored by the SQL view
 * `student_risk_features` (migration 00011). If you add a feature, it must
 * be added in BOTH places or inference will silently score against a
 * different vector than the one the model was trained on.
 */

/** Feature keys, in the order they appear in the model's coefficient map. */
export const RISK_FEATURE_KEYS = [
  "gwa_risk",
  "gwa_delta",
  "failure_ratio",
  "attendance_deficit",
  "violation_severity",
  "open_cases",
  "financial_stress",
  "probationary",
] as const;

export type RiskFeatureKey = (typeof RISK_FEATURE_KEYS)[number];

export type RiskTier = "low" | "moderate" | "high" | "critical";

/**
 * Raw inputs pulled from `student_risk_features`.
 * Every field is nullable because a student may have no verified academic
 * documents yet — the normalizer is responsible for handling absence
 * explicitly rather than coercing nulls to zero.
 */
export interface RawRiskInputs {
  student_id: string;
  student_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  program?: string | null;
  year_level?: string | null;
  scholastic_status?: string | null;

  // Academic — current term
  current_gwa: number | null;
  current_units_enrolled: number | null;
  current_units_failed: number | null;
  current_attendance_rate: number | null;

  // Academic — trend
  previous_gwa: number | null;
  /** current_gwa - previous_gwa. POSITIVE means performance DECLINED. */
  gwa_delta: number | null;
  failure_ratio: number | null;

  // Disciplinary
  minor_violation_count: number | null;
  major_violation_count: number | null;
  open_case_count: number | null;
  days_since_last_violation: number | null;

  // Socioeconomic
  is_listahan: boolean | null;
  is_pwd: boolean | null;
  is_indigenous: boolean | null;
  financial_support: string | null;

  data_completeness: number | null;
}

/** Normalized feature vector — every value in [0, 1]. */
export type NormalizedFeatures = Record<RiskFeatureKey, number>;

/**
 * Per-feature record of how a value was derived and what it contributed.
 * This is what makes the model explainable: `contribution` values plus the
 * intercept sum exactly to the logit, with no approximation.
 */
export interface FeatureContribution {
  feature: RiskFeatureKey;
  /** Human-readable label for the UI. */
  label: string;
  /** The raw, un-normalized value (e.g. GWA of 2.75). */
  rawValue: number | string | null;
  /** The normalized value fed to the model, in [0, 1]. */
  normalizedValue: number;
  /** The model's learned weight for this feature. */
  weight: number;
  /** weight × normalizedValue. Signed: positive increases risk. */
  contribution: number;
  /** Share of the total absolute contribution, 0–1. For sorting/display. */
  relativeImportance: number;
  /** True when the underlying data was missing and a neutral value was substituted. */
  imputed: boolean;
  /** Plain-language explanation shown to OSA staff. */
  explanation: string;
}

export interface RiskModel {
  id: string;
  version_label: string;
  algorithm: string;
  coefficients: Record<RiskFeatureKey, number>;
  intercept: number;
  threshold_moderate: number;
  threshold_high: number;
  threshold_critical: number;
  feature_scaling?: Record<string, unknown> | null;
}

export interface RiskAssessmentResult {
  student_id: string;
  model_version_id: string;
  /** Sigmoid output in [0, 1]. */
  risk_score: number;
  risk_tier: RiskTier;
  /** The logit, before the sigmoid. Useful for debugging. */
  logit: number;
  normalizedFeatures: NormalizedFeatures;
  contributions: FeatureContribution[];
  /** Contributions pushing risk UP, sorted by magnitude descending. */
  topRiskFactors: FeatureContribution[];
  /** Contributions pushing risk DOWN, sorted by magnitude descending. */
  protectiveFactors: FeatureContribution[];
  /** Fraction of core signals that were actually present, 0–1. */
  dataCompleteness: number;
  /**
   * True when completeness is low enough that the score should be shown
   * with a caveat. A student with no uploaded documents will look
   * artificially low-risk, which is worse than showing no score at all.
   */
  lowConfidence: boolean;
}

/** Display labels, kept next to the keys so they cannot drift apart. */
export const FEATURE_LABELS: Record<RiskFeatureKey, string> = {
  gwa_risk: "Academic standing",
  gwa_delta: "Grade trend",
  failure_ratio: "Failed units",
  attendance_deficit: "Attendance",
  violation_severity: "Disciplinary history",
  open_cases: "Open cases",
  financial_stress: "Financial indicators",
  probationary: "Scholastic status",
};
