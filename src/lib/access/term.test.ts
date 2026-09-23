import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getCurrentTerm } from "./term";

// Run as Vercel does. On a developer machine set to Manila time, the server's
// calendar and Manila's agree, and every one of these would pass unfixed.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

it("really is running in UTC", () => {
  expect(new Date(2026, 7, 1, 1).toISOString()).toBe("2026-08-01T01:00:00.000Z");
});

describe("getCurrentTerm on a UTC server", () => {
  it("opens the 1st Semester at Manila midnight on Aug 1", () => {
    // 1 AM Aug 1 in Manila; still Jul 31 in UTC.
    expect(getCurrentTerm(new Date("2026-07-31T17:00:00Z"))).toEqual({
      schoolYear: "2026-2027",
      semester: "1st Semester",
      schoolYearLabel: "AY 2026–2027",
      label: "1st Semester, AY 2026–2027",
    });
  });

  it("opens the 2nd Semester at Manila midnight on Jan 1", () => {
    // 1 AM Jan 1, 2027 in Manila; still Dec 31, 2026 in UTC.
    const term = getCurrentTerm(new Date("2026-12-31T17:00:00Z"));
    expect(term.schoolYear).toBe("2026-2027");
    expect(term.semester).toBe("2nd Semester");
  });

  it("opens Summer at Manila midnight on Jun 1", () => {
    const term = getCurrentTerm(new Date("2027-05-31T17:00:00Z"));
    expect(term.schoolYear).toBe("2026-2027");
    expect(term.semester).toBe("Summer");
  });

  it("keeps the old term until the last Manila second of Jul 31", () => {
    // 11:59:59 PM Jul 31 in Manila.
    const term = getCurrentTerm(new Date("2026-07-31T15:59:59Z"));
    expect(term.schoolYear).toBe("2025-2026");
    expect(term.semester).toBe("Summer");
  });

  it("stores and looks up an ID under the same term all morning", () => {
    // OSA validates at 7 AM on Aug 1 and the student taps in at 9 AM. The
    // turnstile finds the validation by exact match on school year and
    // semester, so the two reads must agree or the student is turned away.
    const validatedAt = new Date("2026-07-31T23:00:00Z");
    const scannedAt = new Date("2026-08-01T01:00:00Z");
    expect(getCurrentTerm(validatedAt)).toEqual(getCurrentTerm(scannedAt));
  });
});
