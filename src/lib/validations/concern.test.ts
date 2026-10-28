import { describe, expect, it } from "vitest";

import { concernCategoryLabel, concernSchema } from "./concern";

const base = {
  subject_line: "Classmate keeps following me",
  body_text: "Since last week a classmate has been following me after class.",
};

describe("concernSchema: a complaint against a student (checklist A3)", () => {
  it("needs the student it is against and the date", () => {
    expect(concernSchema.safeParse({ ...base, category: "Complaint" }).success).toBe(false);
    expect(
      concernSchema.safeParse({ ...base, category: "Complaint", respondent_name: "Juan Dela Cruz" }).success,
    ).toBe(false);
    expect(
      concernSchema.safeParse({
        ...base,
        category: "Complaint",
        respondent_name: "Juan Dela Cruz",
        incident_date: "2026-10-20",
      }).success,
    ).toBe(true);
  });

  it("refuses a date in the future", () => {
    const result = concernSchema.safeParse({
      ...base,
      category: "Complaint",
      respondent_name: "Juan Dela Cruz",
      incident_date: "2999-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("asks nothing extra of an ordinary concern", () => {
    expect(concernSchema.safeParse({ ...base, category: "Personal" }).success).toBe(true);
  });
});

describe("concernCategoryLabel", () => {
  it("spells out a complaint and leaves the rest as they are", () => {
    expect(concernCategoryLabel("Complaint")).toBe("Complaint against a student");
    expect(concernCategoryLabel("Academic")).toBe("Academic");
  });
});
