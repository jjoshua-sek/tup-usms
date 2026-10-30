import { describe, expect, it } from "vitest";

import { byUrgencyThenNewest } from "./queue-order";

const row = (id: string, urgency_level: string | null, created_at: string) => ({ id, urgency_level, created_at });

describe("byUrgencyThenNewest", () => {
  it("puts critical first and unassessed last, not alphabetical order", () => {
    const rows = [
      row("medium", "medium", "2026-10-30T01:00:00Z"),
      row("unassessed", null, "2026-10-30T05:00:00Z"),
      row("low", "low", "2026-10-30T02:00:00Z"),
      row("critical", "critical", "2026-10-29T01:00:00Z"),
      row("high", "high", "2026-10-30T03:00:00Z"),
    ];
    expect(rows.sort(byUrgencyThenNewest).map((r) => r.id)).toEqual(["critical", "high", "medium", "low", "unassessed"]);
  });

  it("shows the newest first within the same urgency", () => {
    const rows = [row("older", "high", "2026-10-29T01:00:00Z"), row("newer", "high", "2026-10-30T01:00:00Z")];
    expect(rows.sort(byUrgencyThenNewest).map((r) => r.id)).toEqual(["newer", "older"]);
  });
});
