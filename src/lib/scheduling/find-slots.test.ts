import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manilaInstant, manilaWallClock } from "@/lib/utils/time";

import {
  DEFAULT_CONFIG,
  findAvailableSlots,
  formatSlot,
  type AvailabilityBlock,
} from "./find-slots";

// The scheduler runs in a server action, so on Vercel it runs in UTC. These
// tests run there too; in Manila time they would pass with the bug in place.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Thursday, September 24, 2026, 9:00 AM in Manila. */
const THURSDAY_9AM = manilaInstant(2026, 8, 24, 9 * 60);

const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

function busy(day: string, start: string, end: string): AvailabilityBlock {
  return {
    id: `${day}-${start}`,
    user_id: "student",
    day_of_week: day,
    specific_date: null,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    block_type: "busy",
    source: "manual",
    label: null,
    valid_from: null,
    valid_until: null,
  };
}

/**
 * Every slot the search keeps, not just the top five. The ranking favours
 * mid-week mornings, and a top-five check can pass by luck of the ranking.
 */
function allSlots(studentBlocks: AvailabilityBlock[], now: Date) {
  return findAvailableSlots({
    complainantBlocks: [],
    studentBlocks,
    now,
    config: { maxProposals: 100 },
  });
}

describe("findAvailableSlots on a UTC server", () => {
  it("proposes only Manila business hours, outside lunch", () => {
    const slots = allSlots([], THURSDAY_9AM);

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const start = manilaWallClock(slot.start).minutes;
      const end = start + DEFAULT_CONFIG.durationMinutes;
      expect(start).toBeGreaterThanOrEqual(minutes(DEFAULT_CONFIG.businessHours.start));
      expect(end).toBeLessThanOrEqual(minutes(DEFAULT_CONFIG.businessHours.end));
      expect(start >= minutes("13:00") || end <= minutes("12:00")).toBe(true);
    }
  });

  it("reads a class block's hours in Manila time", () => {
    // Every weekday morning is taken, so only afternoons are left.
    const mornings = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) =>
      busy(day, "08:00", "12:00"),
    );

    const slots = allSlots(mornings, THURSDAY_9AM);

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const start = manilaWallClock(slot.start).minutes;
      expect(start).toBeGreaterThanOrEqual(minutes("13:00"));
      expect(start + DEFAULT_CONFIG.durationMinutes).toBeLessThanOrEqual(minutes("17:00"));
    }
  });

  it("reads a class block's weekday in Manila time", () => {
    // The week is full except Friday from 4 PM. That opening is Friday 4 PM
    // in Manila — read in UTC it was midnight going into Saturday.
    const blocks = [
      ...["Monday", "Tuesday", "Wednesday", "Thursday"].map((day) => busy(day, "08:00", "17:00")),
      busy("Friday", "08:00", "16:00"),
    ];

    const slots = allSlots(blocks, THURSDAY_9AM);

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const clock = manilaWallClock(slot.start);
      expect(clock.weekday).toBe(5);
      expect(clock.minutes).toBe(minutes("16:00"));
    }
  });

  it("counts the notice period in Manila days", () => {
    // 7:30 AM Thursday in Manila, which is still Wednesday in UTC. Two days'
    // notice runs to Saturday, so the first possible meeting is Monday —
    // counting from UTC's Wednesday would have offered Friday.
    const slots = allSlots([], manilaInstant(2026, 8, 24, 7 * 60 + 30));

    const earliest = Math.min(...slots.map((slot) => slot.start.getTime()));
    expect(earliest).toBeGreaterThanOrEqual(manilaInstant(2026, 8, 28).getTime());
  });
});

describe("formatSlot", () => {
  it("labels the slot in Manila time", () => {
    const slot = {
      start: manilaInstant(2026, 8, 28, 9 * 60),
      end: manilaInstant(2026, 8, 28, 9 * 60 + 45),
      score: 1,
      rationale: "",
      factors: {
        daysOut: 4,
        inPreferredWindow: true,
        dayOfWeek: "Monday",
        isFridayAfternoon: false,
        complainantFreeMinutesAround: 0,
        studentFreeMinutesAround: 0,
      },
    };

    expect(formatSlot(slot)).toBe("Monday, September 28 · 9:00 AM – 9:45 AM");
  });
});
