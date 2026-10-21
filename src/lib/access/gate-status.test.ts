import { describe, expect, it } from "vitest";

import { finalColumns, selectedColumns } from "@/lib/testing/migrations";

import { GATE_CONSOLE_COLUMNS, ONLINE_WINDOW_MS, isGateOnline } from "./gate-status";

describe("isGateOnline", () => {
  const now = Date.parse("2026-10-21T10:00:00Z");

  it("is online within three heartbeats, and never when it has not checked in", () => {
    expect(isGateOnline(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isGateOnline(new Date(now - ONLINE_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(isGateOnline(null, now)).toBe(false);
  });
});

describe("the gate console's query", () => {
  it("selects only columns the migrations create, and never the key's hash", () => {
    const columns = finalColumns("access_gates");
    const selected = selectedColumns(GATE_CONSOLE_COLUMNS);
    expect(selected.filter((c) => !columns.has(c))).toEqual([]);
    expect(selected).not.toContain("device_key_hash");
  });
});
