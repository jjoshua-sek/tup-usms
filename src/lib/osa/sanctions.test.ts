import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manilaInstant } from "@/lib/utils/time";

import { appealWindow } from "./sanctions";

// The case page and the student's violations page count the days left while
// rendering on the server, so on Vercel they count in UTC. In Manila time
// these would pass with the bug in place.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** 7:30 AM Friday, September 25, 2026 in Manila — still Thursday in UTC. */
const FRIDAY_730AM = new Date("2026-09-24T23:30:00Z");

describe("appealWindow on a UTC server", () => {
  it("counts from today's date in Manila", () => {
    // Received Sep 15, so the tenth day is Friday the 25th: today, the last day.
    const window = appealWindow("2026-09-15", 10, FRIDAY_730AM);
    expect(window.daysRemaining).toBe(0);
    expect(window.isOpen).toBe(true);
  });

  it("closes the window on the morning after the last day", () => {
    // Received Sep 14, so Thursday the 24th was the last day. UTC still says
    // Thursday, which would tell the student it is the last day to appeal.
    const window = appealWindow("2026-09-14", 10, FRIDAY_730AM);
    expect(window.daysRemaining).toBe(-1);
    expect(window.isOpen).toBe(false);
  });

  it("keeps the last day open until Manila midnight", () => {
    const window = appealWindow("2026-09-15", 10, manilaInstant(2026, 8, 25, 23 * 60 + 59));
    expect(window.daysRemaining).toBe(0);
    expect(window.isOpen).toBe(true);
  });

  it("gives the deadline in the shape the appeal record stores", () => {
    // openAppealWindow saves `deadline.toISOString().slice(0, 10)` to a date
    // column, so the deadline has to be UTC midnight of the last day.
    const window = appealWindow("2026-09-25", 10, FRIDAY_730AM);
    expect(window.deadline.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(window.daysRemaining).toBe(10);
  });
});
