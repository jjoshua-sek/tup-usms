import { describe, expect, it } from "vitest";

import { CASE_STATUSES } from "@/types/osa";
import { caseNextStep, type CaseState } from "./case-next-step";

const base: CaseState = {
  status: "filed",
  classificationPending: false,
  letterToRead: false,
  dateAwaitingApproval: false,
  dateToNotify: false,
  hasSuggestedTimes: false,
  hasAppeal: false,
};

describe("caseNextStep", () => {
  it("has nothing to do on a closed or dismissed case", () => {
    expect(caseNextStep({ ...base, status: "closed", letterToRead: true }).section).toBeNull();
    expect(caseNextStep({ ...base, status: "dismissed" }).section).toBeNull();
  });

  it("asks for classification before anything else", () => {
    expect(caseNextStep({ ...base, classificationPending: true, letterToRead: true }).section).toBe("classify");
  });

  it("puts work waiting on the OSA ahead of the status", () => {
    expect(caseNextStep({ ...base, status: "awaiting_apology", letterToRead: true }).text).toMatch(/^Read the student's apology letter/);
    expect(caseNextStep({ ...base, dateToNotify: true }).text).toMatch(/Notify the student/);
  });

  it("tells a new case to find or pick a time", () => {
    expect(caseNextStep(base).text).toMatch(/^Find a meeting time/);
    expect(caseNextStep({ ...base, hasSuggestedTimes: true }).text).toBe("Pick one of the suggested meeting times.");
  });

  it("sends a sanctioned case to the appeal section", () => {
    expect(caseNextStep({ ...base, status: "sanctioned" }).text).toMatch(/Notice of Decision/);
    expect(caseNextStep({ ...base, status: "sanctioned", hasAppeal: true }).text).toMatch(/Follow the appeal/);
  });

  it("gives every status a sentence", () => {
    for (const status of CASE_STATUSES) {
      expect(caseNextStep({ ...base, status }).text.length).toBeGreaterThan(10);
    }
  });
});
