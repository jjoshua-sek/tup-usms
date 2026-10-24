import { describe, expect, it } from "vitest";

import { DEFAULT_RETENTION, describeAccessLogRetention, describeRecordRetention, readRetention, retentionSchema } from "./retention";

describe("readRetention", () => {
  it("reads the stored values", () => {
    expect(
      readRetention([
        { key: "record_retention_years", value: 7 },
        { key: "access_log_retention_days", value: 365 },
        { key: "retention_dpo_reference", value: " DPO Memo 2026-14 " },
      ]),
    ).toEqual({ recordYears: 7, accessLogDays: 365, dpoReference: "DPO Memo 2026-14" });
  });

  it("falls back to the team's values before migration 00047, or for a bad value", () => {
    expect(readRetention(null)).toEqual(DEFAULT_RETENTION);
    expect(readRetention([{ key: "record_retention_years", value: "five" }, { key: "access_log_retention_days", value: 5 }])).toEqual(DEFAULT_RETENTION);
  });
});

describe("retentionSchema", () => {
  it("needs the DPO's reference and sensible numbers", () => {
    expect(retentionSchema.safeParse({ recordYears: "5", accessLogDays: "180", dpoReference: "DPO Memo 2026-14" }).success).toBe(true);
    expect(retentionSchema.safeParse({ recordYears: "5", accessLogDays: "180", dpoReference: "" }).success).toBe(false);
    expect(retentionSchema.safeParse({ recordYears: "0", accessLogDays: "180", dpoReference: "Memo 1" }).success).toBe(false);
    expect(retentionSchema.safeParse({ recordYears: "5", accessLogDays: "7", dpoReference: "Memo 1" }).success).toBe(false);
  });
});

describe("wording", () => {
  it("reads naturally", () => {
    expect(describeRecordRetention(DEFAULT_RETENTION)).toBe("5 years after graduation");
    expect(describeRecordRetention({ ...DEFAULT_RETENTION, recordYears: 1 })).toBe("1 year after graduation");
    expect(describeAccessLogRetention({ ...DEFAULT_RETENTION, accessLogDays: 1095 })).toBe("1,095 days");
  });
});
