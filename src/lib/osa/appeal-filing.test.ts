import { describe, expect, it } from "vitest";

import { canFileAppeal, checkGrounds, manilaToday } from "./appeal-filing";

// Noon in Manila (04:00 UTC) on the given date.
const manilaNoon = (date: string) => new Date(`${date}T04:00:00Z`);

describe("canFileAppeal", () => {
  const open = { status: "window_open", penaltyBasis: "suspension_up_to_30_days", noticeReceivedOn: "2026-10-01" };

  it("allows filing inside the ten days, the last day included", () => {
    expect(canFileAppeal({ ...open, now: manilaNoon("2026-10-05") }).ok).toBe(true);
    expect(canFileAppeal({ ...open, now: manilaNoon("2026-10-11") }).ok).toBe(true);
  });

  it("refuses once the period has ended", () => {
    const result = canFileAppeal({ ...open, now: manilaNoon("2026-10-12") });
    expect(result).toEqual({ ok: false, reason: "The appeal period has ended, so the decision stands." });
  });

  it("refuses an appeal already filed, decided or lapsed", () => {
    expect(canFileAppeal({ ...open, status: "filed", now: manilaNoon("2026-10-05") })).toEqual({ ok: false, reason: "This appeal has already been filed." });
    expect(canFileAppeal({ ...open, status: "lapsed", now: manilaNoon("2026-10-05") }).ok).toBe(false);
  });
});

describe("checkGrounds", () => {
  it("asks for real reasons and trims the text", () => {
    expect(checkGrounds("I disagree.").ok).toBe(false);
    const long = `  ${"The sanction was based on a misidentified photo; I was in class. ".repeat(2)}  `;
    const result = checkGrounds(long);
    expect(result.ok && result.text).toBe(long.trim());
    expect(checkGrounds("x".repeat(5001)).ok).toBe(false);
  });
});

describe("manilaToday", () => {
  it("uses the Manila calendar, not the server's", () => {
    // 2026-10-21 23:30 UTC is already Oct 22 in Manila.
    expect(manilaToday(new Date("2026-10-21T23:30:00Z"))).toBe("2026-10-22");
    expect(manilaToday(new Date("2026-01-05T04:00:00Z"))).toBe("2026-01-05");
  });
});
