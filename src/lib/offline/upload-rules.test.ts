import { describe, expect, it } from "vitest";

import { finalColumns, selectedColumns } from "@/lib/testing/migrations";

import { OFFLINE_UPLOAD_COLUMNS, planUploadedValidation, recheckUploadedScan, uploadBodySchema } from "./upload-rules";

describe("planUploadedValidation", () => {
  it("applies a counter validation the cloud would have accepted at the time", () => {
    for (const status of [null, "pending", "under_review", "rejected", "expired"] as const) {
      expect(planUploadedValidation(status)).toBe("validate");
    }
    expect(planUploadedValidation("validated")).toBe("already_validated");
  });

  // A sticker applied offline must not undo a suspension the cloud recorded
  // meanwhile: a person decides that, from the review list.
  it("sends it to the review list when the cloud record was suspended, revoked or surrendered", () => {
    for (const status of ["suspended", "revoked", "surrendered"] as const) {
      expect(planUploadedValidation(status)).toBe("conflict");
    }
  });
});

describe("recheckUploadedScan", () => {
  const scan = { gateId: "gate-lan", direction: "entry" as const, decision: "allow" as const, occurredAt: "2026-10-21T02:00:00Z" };

  it("flags a pass at a gate still on the cloud within two minutes", () => {
    const flags = recheckUploadedScan(scan, [{ gateId: "gate-cloud", direction: "entry", decision: "allow", occurredAt: "2026-10-21T02:01:00Z" }]);
    expect(flags.map((f) => f.type)).toContain("concurrent_use");
  });

  it("flags an entry after an earlier entry with no exit", () => {
    const flags = recheckUploadedScan(scan, [{ gateId: "gate-lan", direction: "entry", decision: "allow", occurredAt: "2026-10-20T23:00:00Z" }]);
    expect(flags.map((f) => f.type)).toEqual(["passback_violation"]);
  });

  it("does not flag a normal day, or a scan that was refused anyway", () => {
    const history = [
      { gateId: "gate-lan", direction: "entry" as const, decision: "allow" as const, occurredAt: "2026-10-20T23:00:00Z" },
      { gateId: "gate-lan", direction: "exit" as const, decision: "allow" as const, occurredAt: "2026-10-21T01:00:00Z" },
    ];
    expect(recheckUploadedScan(scan, history)).toEqual([]);
    expect(recheckUploadedScan({ ...scan, decision: "deny" }, [{ gateId: "gate-cloud", direction: "entry", decision: "allow", occurredAt: scan.occurredAt }])).toEqual([]);
  });
});

describe("uploadBodySchema", () => {
  const gateScan = {
    id: "8a6b9f2e-2d5c-4c55-9a3e-5d0b6f1f2a11",
    kind: "gate_scan",
    occurred_at: "2026-10-21T02:00:00.000Z",
    payload: {
      student_number: "TUPM-22-0148",
      scanned_payload: "TUPM-22-0148",
      gate_id: null,
      gate_label: "Ayala Gate",
      direction: "entry",
      decision: "allow",
      reason: "ok",
      gate_opened: true,
      enforced: true,
    },
  };

  it("accepts what the copy's outbox sends, and refuses an unknown kind", () => {
    expect(uploadBodySchema.safeParse({ records: [gateScan] }).success).toBe(true);
    expect(uploadBodySchema.safeParse({ records: [{ ...gateScan, kind: "case_filed" }] }).success).toBe(false);
    expect(uploadBodySchema.safeParse({ records: [] }).success).toBe(false);
  });
});

describe("the review list's query", () => {
  it("selects only columns migration 00034 creates", () => {
    const columns = finalColumns("offline_uploads");
    expect(selectedColumns(OFFLINE_UPLOAD_COLUMNS).filter((c) => !columns.has(c))).toEqual([]);
  });
});
