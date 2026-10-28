import { describe, expect, it } from "vitest";

import { needsComplainantApproval } from "./hearing-approval";

describe("needsComplainantApproval", () => {
  it("waits for a faculty complainant to approve a hearing", () => {
    expect(needsComplainantApproval({ hearingType: "conference", complainantRole: "faculty" })).toBe(true);
    expect(needsComplainantApproval({ hearingType: "mediation", complainantRole: "faculty" })).toBe(true);
  });

  it("lets the OSA date its own cases and complainants without an account", () => {
    expect(needsComplainantApproval({ hearingType: "conference", complainantRole: null })).toBe(false);
    expect(needsComplainantApproval({ hearingType: "conference", complainantRole: "osa_officer" })).toBe(false);
    expect(needsComplainantApproval({ hearingType: "conference", complainantRole: "security_guard" })).toBe(false);
  });

  it("never holds a counselling session for the complainant", () => {
    expect(needsComplainantApproval({ hearingType: "counselling", complainantRole: "faculty" })).toBe(false);
  });
});
