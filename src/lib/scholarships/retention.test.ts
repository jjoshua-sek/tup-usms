import { describe, expect, it } from "vitest";

import type { ScholarshipCriterion, StudentEligibilityProfile } from "./evaluate-eligibility";
import { checkRetention } from "./retention";

const criterion = (key: ScholarshipCriterion["criterion_key"], operator: ScholarshipCriterion["operator"], value: unknown, description: string, mandatory = true): ScholarshipCriterion => ({
  id: key,
  scholarship_id: "s1",
  criterion_key: key,
  operator,
  value,
  is_mandatory: mandatory,
  human_description: description,
  display_order: 0,
});

const criteria = [
  criterion("gwa", "lte", 2.25, "GWA of 2.25 or better"),
  criterion("no_failing_grades", "is_true", true, "No failing grades"),
  criterion("no_major_violations", "is_true", true, "No major offense on record"),
  // Settled at the award; a scholar fails this one by definition.
  criterion("has_no_other_scholarship", "is_true", true, "Not holding another scholarship"),
  criterion("is_listahan", "is_true", true, "Listed in Listahanan"),
];

const scholar: StudentEligibilityProfile = {
  student_id: "st1",
  gwa: 1.5,
  units_enrolled: 21,
  units_failed: 0,
  year_level: "3rd Year",
  program: "BSIT",
  department: null,
  scholastic_status: "Regular",
  major_violation_count: 0,
  minor_violation_count: 0,
  open_case_count: 0,
  is_listahan: false,
  is_indigenous: false,
  is_pwd: false,
  financial_support: null,
  family_income_bracket: null,
  residency_province: null,
  is_graduating: false,
  has_active_scholarship: true,
};

describe("checkRetention", () => {
  it("keeps a scholar who still meets the grade and conduct requirements, ignoring award-time rules", () => {
    const result = checkRetention("s1", criteria, scholar);
    expect(result.status).toBe("keeps");
    expect(result.failing).toEqual([]);
  });

  it("flags a scholar whose GWA slipped past the limit", () => {
    const result = checkRetention("s1", criteria, { ...scholar, gwa: 2.75 });
    expect(result.status).toBe("at_risk");
    expect(result.failing.map((f) => f.description)).toEqual(["GWA of 2.25 or better"]);
    expect(result.summary).toMatch(/No longer meets 1 requirement/);
  });

  it("flags a failed subject and a major offense", () => {
    const result = checkRetention("s1", criteria, { ...scholar, units_failed: 3, major_violation_count: 1 });
    expect(result.failing.map((f) => f.description)).toEqual(["No failing grades", "No major offense on record"]);
  });

  it("says it cannot check when there are no verified grades, rather than guessing", () => {
    const result = checkRetention("s1", criteria, { ...scholar, gwa: null, units_failed: null });
    expect(result.status).toBe("unknown");
    expect(result.unchecked).toContain("GWA of 2.25 or better");
  });

  it("reads the database's 'gpa' spelling of the grade criterion", () => {
    const fromDatabase = [{ ...criteria[0], criterion_key: "gpa" as never }];
    expect(checkRetention("s1", fromDatabase, { ...scholar, gwa: 2.75 }).status).toBe("at_risk");
    expect(checkRetention("s1", fromDatabase, scholar).status).toBe("keeps");
  });

  it("keeps everyone for a scholarship with no requirement to keep", () => {
    expect(checkRetention("s1", [criteria[3], criteria[4]], scholar).status).toBe("keeps");
  });
});
