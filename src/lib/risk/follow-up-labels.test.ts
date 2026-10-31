import { describe, expect, it } from "vitest";

import { FOLLOW_UP_TYPE_LABELS, followUpStatusLabel, followUpTypeLabel } from "./follow-up-labels";
import { suggestInterventions } from "./score";
import type { RiskAssessmentResult } from "./types";

describe("follow-up labels", () => {
  it("names the known types and statuses in words", () => {
    expect(followUpTypeLabel("guidance_referral")).toBe("Guidance referral");
    expect(followUpStatusLabel("recommended")).toBe("Not started");
    expect(followUpStatusLabel("in_progress")).toBe("In progress");
  });

  it("turns a hand-typed type into words rather than showing the code", () => {
    expect(followUpTypeLabel("parent_conference")).toBe("Parent conference");
    expect(followUpTypeLabel("Home visit")).toBe("Home visit");
  });

  it("has a label for every type the model can suggest", () => {
    // A critical assessment with every feature raised draws every suggestion.
    const assessment = {
      risk_tier: "critical",
      contributions: [
        "gwa_risk", "gwa_delta", "failure_ratio", "attendance_deficit",
        "financial_stress", "violation_severity", "open_cases",
      ].map((feature) => ({ feature, normalizedValue: 1 })),
    } as unknown as RiskAssessmentResult;
    expect(suggestInterventions(assessment)).toHaveLength(6);
    for (const suggestion of suggestInterventions(assessment)) {
      expect(FOLLOW_UP_TYPE_LABELS, suggestion.type).toHaveProperty(suggestion.type);
    }
  });
});
