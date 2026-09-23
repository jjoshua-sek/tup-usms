import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  formatManila,
  formatManilaDate,
  formatManilaDateTime,
  formatManilaLongDate,
  formatManilaTime,
  manilaInstant,
  manilaWallClock,
  parseManilaDateTime,
} from "./time";

// Run as Vercel does. On a developer machine set to Manila time, every one of
// these would pass with or without the zone pinning, and prove nothing.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

it("really is running in UTC", () => {
  expect(new Date(2026, 8, 25, 9).toISOString()).toBe("2026-09-25T09:00:00.000Z");
});

describe("Manila formatting on a UTC server", () => {
  it("puts an early-morning timestamp on the Manila date, not the UTC one", () => {
    // 1:30 AM on the 25th in Manila; still the 24th in UTC.
    expect(formatManilaDate("2026-09-24T17:30:00Z")).toBe("Sep 25, 2026");
  });

  it("prints the Manila hour", () => {
    expect(formatManilaTime("2026-09-25T01:00:00Z")).toBe("9:00 AM");
    expect(formatManilaDateTime("2026-09-25T01:00:00Z")).toBe("Sep 25, 2026, 9:00 AM");
  });

  it("states a summons the way the email does", () => {
    const when = formatManila("2026-09-25T01:00:00Z", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(when).toBe("Friday, September 25 at 9:00 AM");
  });

  it("keeps a date column on the date it holds", () => {
    expect(formatManilaLongDate("2026-09-24")).toBe("September 24, 2026");
  });

  it("accepts a Date as well as a string", () => {
    expect(formatManilaTime(new Date("2026-09-25T01:00:00Z"))).toBe("9:00 AM");
  });

  it("shows a dash for a missing value", () => {
    expect(formatManilaDate(null)).toBe("—");
    expect(formatManilaDateTime(undefined)).toBe("—");
  });
});

describe("manilaWallClock", () => {
  it("reads the Manila calendar, not the server's", () => {
    // 11:30 PM Thursday in UTC is 7:30 AM Friday in Manila.
    expect(manilaWallClock(new Date("2026-09-24T23:30:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 25,
      weekday: 5,
      minutes: 7 * 60 + 30,
    });
  });
});

describe("manilaInstant", () => {
  it("places a Manila wall-clock time eight hours ahead of UTC", () => {
    expect(manilaInstant(2026, 8, 25, 9 * 60).toISOString()).toBe("2026-09-25T01:00:00.000Z");
  });

  it("rolls days over into the next month", () => {
    expect(manilaInstant(2026, 8, 31).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });
});

describe("parseManilaDateTime", () => {
  it("reads a datetime-local value as Manila time", () => {
    const start = parseManilaDateTime("2026-09-25T09:00");
    expect(start?.toISOString()).toBe("2026-09-25T01:00:00.000Z");
    expect(formatManilaTime(start)).toBe("9:00 AM");
  });

  it("refuses a date that does not exist rather than moving it", () => {
    expect(parseManilaDateTime("2026-02-30T09:00")).toBeNull();
  });

  it("refuses anything that is not a wall-clock time", () => {
    expect(parseManilaDateTime("2026-09-25T24:00")).toBeNull();
    expect(parseManilaDateTime("2026-09-25")).toBeNull();
    expect(parseManilaDateTime("2026-09-25T09:00Z")).toBeNull();
    expect(parseManilaDateTime("next Friday")).toBeNull();
  });
});
