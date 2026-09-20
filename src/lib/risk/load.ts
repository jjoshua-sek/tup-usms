import "server-only";

import type { LooseClient } from "@/lib/supabase/loose";
import type { StudentRiskFeaturesRow } from "@/types/osa";

import type { RawRiskInputs, RiskFeatureKey, RiskModel } from "./types";

/**
 * Loads the model that inference should run against.
 *
 * Exactly one row in `risk_model_versions` is active at a time. Reading the
 * weights from the database rather than hard-coding them is what lets a
 * retrained model be promoted without redeploying — and it keeps every stored
 * assessment traceable to the exact coefficients that produced it.
 */
export async function loadActiveRiskModel(db: LooseClient): Promise<RiskModel | null> {
  const { data } = await db
    .from("risk_model_versions")
    .select(
      "id, version_label, algorithm, coefficients, intercept, threshold_moderate, threshold_high, threshold_critical, feature_scaling",
    )
    .eq("is_active", true)
    .maybeSingle();

  const row = data as {
    id: string;
    version_label: string;
    algorithm: string;
    coefficients: Record<string, number | string>;
    intercept: number | string;
    threshold_moderate: number | string;
    threshold_high: number | string;
    threshold_critical: number | string;
    feature_scaling: Record<string, unknown> | null;
  } | null;
  if (!row) return null;

  // PostgREST can hand back NUMERIC as a string; coercing here keeps the
  // arithmetic in `scoreStudent` from silently becoming string concatenation.
  const coefficients = Object.fromEntries(
    Object.entries(row.coefficients ?? {}).map(([key, value]) => [key, Number(value)]),
  ) as Record<RiskFeatureKey, number>;

  return {
    id: row.id,
    version_label: row.version_label,
    algorithm: row.algorithm,
    coefficients,
    intercept: Number(row.intercept),
    threshold_moderate: Number(row.threshold_moderate),
    threshold_high: Number(row.threshold_high),
    threshold_critical: Number(row.threshold_critical),
    feature_scaling: row.feature_scaling,
  };
}

const FEATURE_COLUMNS =
  "student_id, student_number, first_name, last_name, program, year_level, scholastic_status, current_gwa, current_units_enrolled, current_units_failed, current_attendance_rate, previous_gwa, gwa_delta, failure_ratio, minor_violation_count, major_violation_count, open_case_count, days_since_last_violation, is_listahan, is_pwd, is_indigenous, financial_support, data_completeness";

/** Reads the `student_risk_features` view (migration 00011). */
export async function loadRiskFeatures(
  db: LooseClient,
  options: { studentId?: string; limit?: number } = {},
): Promise<StudentRiskFeaturesRow[]> {
  let query = db.from("student_risk_features").select(FEATURE_COLUMNS);
  if (options.studentId) query = query.eq("student_id", options.studentId);

  const { data } = await query.limit(options.limit ?? 500);
  return (data as StudentRiskFeaturesRow[] | null) ?? [];
}

/** The view's row shape is the model's input shape — this just names that. */
export function featuresToInputs(row: StudentRiskFeaturesRow): RawRiskInputs {
  return {
    student_id: row.student_id,
    student_number: row.student_number,
    first_name: row.first_name,
    last_name: row.last_name,
    program: row.program,
    year_level: row.year_level,
    scholastic_status: row.scholastic_status,
    current_gwa: numeric(row.current_gwa),
    current_units_enrolled: numeric(row.current_units_enrolled),
    current_units_failed: numeric(row.current_units_failed),
    current_attendance_rate: numeric(row.current_attendance_rate),
    previous_gwa: numeric(row.previous_gwa),
    gwa_delta: numeric(row.gwa_delta),
    failure_ratio: numeric(row.failure_ratio),
    minor_violation_count: numeric(row.minor_violation_count),
    major_violation_count: numeric(row.major_violation_count),
    open_case_count: numeric(row.open_case_count),
    days_since_last_violation: numeric(row.days_since_last_violation),
    is_listahan: row.is_listahan,
    is_pwd: row.is_pwd,
    is_indigenous: row.is_indigenous,
    financial_support: row.financial_support,
    data_completeness: numeric(row.data_completeness),
  };
}

function numeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
