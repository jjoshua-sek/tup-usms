import { describe, expect, it } from "vitest";

import { canChooseRiskModel, summarizeModelVersion } from "./versions";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  version_label: "v2.0-synthetic",
  is_active: false,
  trained_on_records: 3000,
  training_date: "2026-10-29",
  performance_metrics: { status: "trained_synthetic", auc_roc: 0.8311, precision: 0.3656, recall: "0.83" },
};

describe("canChooseRiskModel", () => {
  it("allows the OSA head and the administrator only, as the database does", () => {
    expect(canChooseRiskModel("osa_head")).toBe(true);
    expect(canChooseRiskModel("admin")).toBe(true);
    for (const role of ["osa_officer", "guidance_counselor", "faculty", "registrar", null, undefined]) {
      expect(canChooseRiskModel(role)).toBe(false);
    }
  });
});

describe("summarizeModelVersion", () => {
  it("reads the held-out figures and says they are synthetic", () => {
    const summary = summarizeModelVersion(row);
    expect(summary).toMatchObject({ auc: 0.8311, precision: 0.3656, recall: 0.83, trainedOn: 3000 });
    expect(summary.source).toMatch(/synthetic/i);
    expect(summary.sourceInSentence).toContain("STARS");
    expect(summary.caveat).toMatch(/not TUP students/);
  });

  it("shows the seeded baseline as never evaluated, with no figures", () => {
    const summary = summarizeModelVersion({
      ...row,
      version_label: "v1.0-baseline",
      is_active: true,
      trained_on_records: 0,
      performance_metrics: { status: "untrained_baseline", note: "No performance metrics" },
    });
    expect(summary).toMatchObject({ auc: null, precision: null, recall: null, trainedOn: null, active: true });
    expect(summary.caveat).toMatch(/Never evaluated/);
  });

  it("copes with a version that recorded nothing", () => {
    expect(summarizeModelVersion({ ...row, performance_metrics: null })).toMatchObject({
      source: "Not recorded",
      auc: null,
      caveat: null,
    });
  });
});
