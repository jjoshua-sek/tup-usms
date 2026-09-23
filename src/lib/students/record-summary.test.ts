import { describe, expect, it } from "vitest";

import {
  describeService,
  outstandingServiceHours,
  summarizeRecord,
  type GlanceInput,
  type NoticeDelivery,
} from "./record-summary";

const unread: NoticeDelivery = {
  channels: ["in_app", "email"],
  is_read: false,
  read_at: null,
  email_status: "queued",
  email_sent_at: null,
  email_recipient: null,
};

describe("describeService", () => {
  it("treats opening the notice as the strongest evidence", () => {
    const evidence = describeService({
      ...unread,
      is_read: true,
      read_at: "2026-09-20T02:00:00Z",
      email_status: "sent",
      email_sent_at: "2026-09-20T01:00:00Z",
      email_recipient: "tupm-24-0123@tup.edu.ph",
    });

    expect(evidence.tone).toBe("success");
    expect(evidence.headline).toBe("Opened in the portal");
    expect(evidence.openedAt).toBe("2026-09-20T02:00:00Z");
  });

  it("still counts an opened notice as served when the email failed", () => {
    // Reading it in the portal is proof on its own; a bounced email copy
    // does not undo that.
    const evidence = describeService({
      ...unread,
      is_read: true,
      read_at: "2026-09-20T02:00:00Z",
      email_status: "undeliverable",
    });

    expect(evidence.tone).toBe("success");
    expect(evidence.email).toBe("failed");
  });

  it("distinguishes emailed from opened", () => {
    const evidence = describeService({
      ...unread,
      email_status: "sent",
      email_sent_at: "2026-09-20T01:00:00Z",
      email_recipient: "tupm-24-0123@tup.edu.ph",
    });

    expect(evidence.tone).toBe("info");
    expect(evidence.headline).toMatch(/Emailed/);
    expect(evidence.headline).toMatch(/not yet opened/);
    expect(evidence.emailedTo).toBe("tupm-24-0123@tup.edu.ph");
  });

  it("does not treat a retrying send as delivered", () => {
    // 'failed' is the retryable state in 00019 — the message may still go.
    for (const status of ["queued", "sending", "failed"]) {
      const evidence = describeService({ ...unread, email_status: status });
      expect(evidence.email, status).toBe("in_flight");
      expect(evidence.tone, status).toBe("warning");
    }
  });

  // The case an officer must not miss before proceeding ex parte.
  it("flags an unopened notice whose email could not be delivered", () => {
    for (const status of ["undeliverable", "bounced"]) {
      const evidence = describeService({ ...unread, email_status: status });
      expect(evidence.tone, status).toBe("danger");
      expect(evidence.headline, status).toMatch(/serve it by hand/);
    }
  });

  it("never reports a skipped email as sent", () => {
    // 'skipped' covers the console provider and opt-outs; nothing left.
    const evidence = describeService({ ...unread, email_status: "skipped" });

    expect(evidence.email).toBe("not_emailed");
    expect(evidence.emailedTo).toBeNull();
    expect(evidence.headline).toBe("Portal only — not yet opened");
  });

  it("does not report an address for mail that never went", () => {
    const evidence = describeService({
      ...unread,
      email_status: "undeliverable",
      email_recipient: "tupm-24-0123@tup.edu.ph",
    });

    expect(evidence.emailedTo).toBeNull();
  });
});

describe("outstandingServiceHours", () => {
  it("counts only open assignments", () => {
    expect(
      outstandingServiceHours([
        { status: "assigned", hours_required: 15, hours_completed: 0 },
        { status: "in_progress", hours_required: 10, hours_completed: "4.5" },
        { status: "completed", hours_required: 40, hours_completed: 40 },
      ]),
    ).toBe(20.5);
  });

  it("does not let over-served hours offset another sanction", () => {
    expect(
      outstandingServiceHours([
        { status: "in_progress", hours_required: 10, hours_completed: 14 },
        { status: "assigned", hours_required: 15, hours_completed: 0 },
      ]),
    ).toBe(15);
  });

  it("counts service marked not_served, as clearance does", () => {
    expect(
      outstandingServiceHours([{ status: "not_served", hours_required: 10, hours_completed: 2 }]),
    ).toBe(8);
  });
});

describe("summarizeRecord", () => {
  const term = { schoolYear: "2026-2027", semester: "1st Semester" };
  const base: GlanceInput = {
    cases: [],
    service: [],
    clearance: [],
    idValidations: [],
    term,
  };

  const item = (input: GlanceInput, key: string) =>
    summarizeRecord(input).find((entry) => entry.key === key);

  it("counts only non-terminal cases as open", () => {
    const result = item(
      { ...base, cases: [{ status: "hearing_scheduled" }, { status: "closed" }, { status: "dismissed" }] },
      "cases",
    );

    expect(result?.value).toBe("1");
    expect(result?.tone).toBe("danger");
  });

  // A registrar cannot see cases. Showing them "Open cases: None" would be
  // a false statement, not a restricted one.
  it("omits sections the viewer cannot see rather than reporting zero", () => {
    const keys = summarizeRecord({ ...base, cases: null, service: null }).map((entry) => entry.key);

    expect(keys).not.toContain("cases");
    expect(keys).not.toContain("service");
    expect(keys).toEqual(["id", "clearance"]);
  });

  it("reads the ID status for the current term only", () => {
    const result = item(
      {
        ...base,
        idValidations: [
          { school_year: "2025-2026", semester: "2nd Semester", status: "validated" },
          { school_year: "2026-2027", semester: "1st Semester", status: "suspended" },
        ],
      },
      "id",
    );

    expect(result?.value).toBe("Suspended");
    expect(result?.tone).toBe("danger");
  });

  it("warns when there is no validation for this term", () => {
    const result = item(
      {
        ...base,
        idValidations: [{ school_year: "2025-2026", semester: "2nd Semester", status: "validated" }],
      },
      "id",
    );

    expect(result?.value).toBe("Not validated");
    expect(result?.tone).toBe("warning");
  });

  it("reports the most recent clearance request", () => {
    const result = item(
      {
        ...base,
        clearance: [
          { status: "issued", created_at: "2026-03-01T00:00:00Z" },
          { status: "on_hold", created_at: "2026-09-01T00:00:00Z" },
        ],
      },
      "clearance",
    );

    expect(result?.value).toBe("On Hold");
    expect(result?.tone).toBe("danger");
  });

  it("formats outstanding service hours", () => {
    expect(
      item({ ...base, service: [{ status: "assigned", hours_required: 1, hours_completed: 0 }] }, "service")
        ?.value,
    ).toBe("1 hour");
    expect(
      item({ ...base, service: [{ status: "assigned", hours_required: 15, hours_completed: 0 }] }, "service")
        ?.value,
    ).toBe("15 hours");
  });
});
