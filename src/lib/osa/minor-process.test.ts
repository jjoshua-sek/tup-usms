import { describe, expect, it } from "vitest";

import { apologyResolutionPath, canChooseMinorProcess, minorProcessOf, minorProcessPlan, repeatOffenseAdvice } from "./minor-process";

describe("minorProcessPlan", () => {
  it("leaves the default to the counselling session the officer schedules", () => {
    expect(minorProcessPlan("counselling_apology")).toEqual({ nextStatus: null, resolutionPath: null, sanctionApplied: null });
  });

  it("asks for the letter at once when there is no counselling", () => {
    expect(minorProcessPlan("apology_only").nextStatus).toBe("awaiting_apology");
  });

  it("closes the case with a written warning", () => {
    expect(minorProcessPlan("warning_only")).toEqual({ nextStatus: "closed", resolutionPath: "warning_only", sanctionApplied: "Written warning" });
  });
});

describe("the choice", () => {
  it("is offered only for an open minor case not yet at the apology stage", () => {
    expect(canChooseMinorProcess({ classification: "minor", status: "under_review" })).toBe(true);
    expect(canChooseMinorProcess({ classification: "minor", status: "counselling_scheduled" })).toBe(true);
    expect(canChooseMinorProcess({ classification: "minor", status: "awaiting_apology" })).toBe(false);
    expect(canChooseMinorProcess({ classification: "minor", status: "closed" })).toBe(false);
    expect(canChooseMinorProcess({ classification: "major", status: "under_review" })).toBe(false);
  });

  it("reads cases from before migration 00039 as the default", () => {
    expect(minorProcessOf(undefined)).toBe("counselling_apology");
    expect(minorProcessOf("warning_only")).toBe("warning_only");
  });

  it("closes an accepted letter by the path that was chosen", () => {
    expect(apologyResolutionPath("apology_only")).toBe("apology_only");
    expect(apologyResolutionPath(null)).toBe("counselling_apology");
  });
});

describe("repeatOffenseAdvice", () => {
  it("says nothing for a first offense and quotes the ladder after that", () => {
    expect(repeatOffenseAdvice(0)).toBeNull();
    expect(repeatOffenseAdvice(1)).toMatch(/2nd minor offense.*10 to 20 hours/);
    expect(repeatOffenseAdvice(2)).toMatch(/3rd minor offense.*30 to 50 hours/);
    expect(repeatOffenseAdvice(10)).toMatch(/11th/);
  });
});
