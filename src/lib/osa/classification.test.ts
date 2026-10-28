import { describe, expect, it } from "vitest";

import { canClassify, isClassificationPending } from "./classification";

describe("isClassificationPending", () => {
  it("is pending only when the flag is set", () => {
    expect(isClassificationPending({ classification_pending: true })).toBe(true);
    expect(isClassificationPending({ classification_pending: false })).toBe(false);
  });

  it("treats rows from before 00049 as classified by the Manual", () => {
    expect(isClassificationPending({})).toBe(false);
    expect(isClassificationPending({ classification_pending: null })).toBe(false);
  });
});

describe("canClassify", () => {
  it("lets the OSA classify an offense the Manual does not list", () => {
    expect(canClassify({ in_handbook: false, status: "filed" })).toBe(true);
    expect(canClassify({ in_handbook: false, status: "under_review" })).toBe(true);
  });

  it("leaves Manual offenses to the Manual", () => {
    expect(canClassify({ in_handbook: true, status: "filed" })).toBe(false);
    expect(canClassify({ status: "filed" })).toBe(false);
  });

  it("refuses once the case is over", () => {
    expect(canClassify({ in_handbook: false, status: "closed" })).toBe(false);
    expect(canClassify({ in_handbook: false, status: "dismissed" })).toBe(false);
  });
});
