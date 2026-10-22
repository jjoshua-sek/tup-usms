import { describe, expect, it } from "vitest";

import { latestOfEach } from "./snapshot-figures";

describe("latestOfEach", () => {
  it("keeps last term's verified GWA when this term's COR has no grades yet", () => {
    const rows = [
      { gwa: null, units_enrolled: 18, units_failed: null, scholastic_status: null }, // 1st Sem 2026-27, from the COR
      { gwa: 1.5, units_enrolled: 21, units_failed: 0, scholastic_status: "Regular" }, // 2nd Sem 2025-26, rating slip
    ];
    expect(latestOfEach(rows)).toEqual({ gwa: 1.5, units_failed: 0, units_enrolled: 18, scholastic_status: "Regular" });
  });

  it("takes units failed from the same term as the GWA", () => {
    const rows = [
      { gwa: null, units_enrolled: 18, units_failed: 3, scholastic_status: null },
      { gwa: 2.0, units_enrolled: 21, units_failed: 0, scholastic_status: null },
    ];
    expect(latestOfEach(rows)?.units_failed).toBe(0);
  });

  it("has nothing to give when there are no terms", () => {
    expect(latestOfEach([])).toBeUndefined();
  });
});
