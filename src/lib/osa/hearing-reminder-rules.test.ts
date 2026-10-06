import { describe, expect, it } from "vitest";

import { finalColumns, selectedColumns } from "@/lib/testing/migrations";

import {
  FRESH_SUMMONS_MS,
  REMINDER_HEARING_COLUMNS,
  isReminderDue,
  relativeDay,
  reminderLeadHours,
  type HearingForReminder,
} from "./hearing-reminder-rules";

// 9:00 AM in Manila on Wednesday, October 7, 2026.
const now = new Date("2026-10-07T01:00:00Z");
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

const hearing = (overrides: Partial<HearingForReminder> = {}): HearingForReminder => ({
  status: "student_notified",
  scheduled_start: hoursFromNow(20),
  student_notified_at: hoursFromNow(-48),
  reminder_sent_at: null,
  ...overrides,
});

describe("isReminderDue", () => {
  it("is due for a summoned hearing inside the lead time", () => {
    expect(isReminderDue(hearing(), now, 24)).toBe(true);
    expect(isReminderDue(hearing({ status: "student_acknowledged" }), now, 24)).toBe(true);
    expect(isReminderDue(hearing({ status: "confirmed" }), now, 24)).toBe(true);
  });

  it("waits until the hearing is inside the lead time", () => {
    expect(isReminderDue(hearing({ scheduled_start: hoursFromNow(30) }), now, 24)).toBe(false);
  });

  it("never reminds twice, or after the hearing has started", () => {
    expect(isReminderDue(hearing({ reminder_sent_at: hoursFromNow(-1) }), now, 24)).toBe(false);
    expect(isReminderDue(hearing({ scheduled_start: hoursFromNow(-0.5) }), now, 24)).toBe(false);
  });

  it("skips hearings the student was never summoned to, or that are off", () => {
    for (const status of ["awaiting_complainant", "complainant_approved", "cancelled", "rescheduled", "completed"]) {
      expect(isReminderDue(hearing({ status }), now, 24)).toBe(false);
    }
  });

  it("does not stack a reminder on a summons sent moments ago", () => {
    const fresh = hearing({ student_notified_at: new Date(now.getTime() - FRESH_SUMMONS_MS + 60_000).toISOString() });
    expect(isReminderDue(fresh, now, 24)).toBe(false);
    const older = hearing({ student_notified_at: new Date(now.getTime() - FRESH_SUMMONS_MS - 60_000).toISOString() });
    expect(isReminderDue(older, now, 24)).toBe(true);
  });
});

describe("relativeDay", () => {
  it("counts days by the Manila calendar, not the server's", () => {
    // 11:30 PM Manila the same evening is still today.
    expect(relativeDay(new Date("2026-10-07T15:30:00Z"), now)).toBe("today");
    // 12:30 AM Manila the next day is tomorrow, though it is still October 7 in UTC.
    expect(relativeDay(new Date("2026-10-07T16:30:00Z"), now)).toBe("tomorrow");
    expect(relativeDay(new Date("2026-10-09T02:00:00Z"), now)).toBe("on Friday");
  });
});

describe("reminderLeadHours", () => {
  it("defaults to a day and keeps configured values within 1 to 72 hours", () => {
    expect(reminderLeadHours({})).toBe(24);
    expect(reminderLeadHours({ HEARING_REMINDER_HOURS: "48" })).toBe(48);
    expect(reminderLeadHours({ HEARING_REMINDER_HOURS: "0" })).toBe(1);
    expect(reminderLeadHours({ HEARING_REMINDER_HOURS: "500" })).toBe(72);
    expect(reminderLeadHours({ HEARING_REMINDER_HOURS: "soon" })).toBe(24);
  });
});

describe("the reminder job's columns", () => {
  it("exist on case_hearings once every migration has run", () => {
    const columns = finalColumns("case_hearings");
    const missing = selectedColumns(REMINDER_HEARING_COLUMNS).filter((column) => !columns.has(column));
    expect(missing).toEqual([]);
  });
});
