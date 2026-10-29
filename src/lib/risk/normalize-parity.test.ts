import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeFeatures, scoreStudent } from "./score";
import { RISK_FEATURE_KEYS, type RawRiskInputs, type RiskFeatureKey, type RiskModel } from "./types";

/**
 * The model is trained in Python (ml/train.py) on inputs normalized by
 * ml/features.py, and scored here by normalizeFeatures(). If the two ever
 * scale an input differently, the trained weights mean something else in
 * the app and every score is quietly wrong. train.py writes the rows it
 * normalized and scored; this test normalizes and scores them again here,
 * with the trained model exactly as migration 00053 stores it.
 */
interface ParityCase {
  inputs: Omit<RawRiskInputs, "student_id" | "data_completeness"> & { student_number: string };
  normalized: Record<string, number>;
  risk_score: number;
}

const output = (file: string) => JSON.parse(readFileSync(join(process.cwd(), "ml", "output", file), "utf8"));
const cases = output("normalization_cases.json") as ParityCase[];
const trained = output("model.json") as {
  version_label: string;
  coefficients: Record<RiskFeatureKey, number>;
  intercept: number;
  thresholds: { moderate: number; high: number; critical: number };
};
const model: RiskModel = {
  id: "parity",
  version_label: trained.version_label,
  algorithm: "logistic_regression",
  coefficients: trained.coefficients,
  intercept: trained.intercept,
  threshold_moderate: trained.thresholds.moderate,
  threshold_high: trained.thresholds.high,
  threshold_critical: trained.thresholds.critical,
};

const rawInputs = (c: ParityCase): RawRiskInputs => ({
  ...c.inputs,
  student_id: c.inputs.student_number,
  data_completeness: null,
});

describe("normalization parity with ml/features.py", () => {
  it("has cases covering missing slips, first-years, discipline, status and financial strain", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.some((c) => c.inputs.current_gwa == null)).toBe(true);
    expect(cases.some((c) => c.inputs.previous_gwa == null)).toBe(true);
    expect(cases.some((c) => (c.inputs.major_violation_count ?? 0) > 0)).toBe(true);
    expect(cases.some((c) => (c.inputs.open_case_count ?? 0) > 0)).toBe(true);
    expect(cases.some((c) => c.inputs.scholastic_status !== "Regular")).toBe(true);
    expect(cases.some((c) => c.inputs.is_listahan)).toBe(true);
  });

  it.each(cases.map((c) => [c.inputs.student_number, c] as const))("%s normalizes and scores the same", (_, c) => {
    const { features } = normalizeFeatures(rawInputs(c));
    for (const key of RISK_FEATURE_KEYS) {
      expect(features[key], key).toBeCloseTo(c.normalized[key], 10);
    }
    expect(scoreStudent(rawInputs(c), model).risk_score).toBeCloseTo(c.risk_score, 10);
  });
});

describe("the trained model as shipped", () => {
  it("has a weight for every input and none below zero", () => {
    expect(Object.keys(trained.coefficients).sort()).toEqual([...RISK_FEATURE_KEYS].sort());
    for (const key of RISK_FEATURE_KEYS) expect(trained.coefficients[key], key).toBeGreaterThanOrEqual(0);
  });

  it("gives attendance no weight, since the OSA has no attendance data", () => {
    expect(trained.coefficients.attendance_deficit).toBe(0);
  });

  it("has tier cut points in order", () => {
    const { moderate, high, critical } = trained.thresholds;
    expect(0 < moderate && moderate < high && high < critical && critical < 1).toBe(true);
  });

  it("matches migration 00053", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "00053_risk_model_v2_synthetic.sql"), "utf8");
    expect(sql).toContain(`'${trained.version_label}'`);
    const stored = sql.match(/'(\{"gwa_risk"[^']*)'::jsonb/);
    expect(stored, "coefficients in 00053").not.toBeNull();
    expect(JSON.parse(stored![1])).toEqual(trained.coefficients);
    expect(sql).toContain(trained.intercept.toFixed(6));
  });
});
