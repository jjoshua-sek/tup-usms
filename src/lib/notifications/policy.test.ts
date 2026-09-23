import { describe, expect, it } from "vitest";

import {
  ALWAYS_DELIVER,
  DEFAULT_PREFERENCES,
  decideDelivery,
  type NotificationPreferences,
} from "./policy";

const MUTED: NotificationPreferences = {
  email_enabled: false,
  scholarship_alerts: false,
  guidance_reminders: false,
  announcements: false,
};

const RECIPIENT = "tupm-24-0123@tup.edu.ph";

describe("decideDelivery", () => {
  it("sends ordinary mail when nothing is muted", () => {
    const decision = decideDelivery({
      type: "scholarship_match",
      recipient: RECIPIENT,
      preferences: DEFAULT_PREFERENCES,
    });

    expect(decision.send).toBe(true);
    expect(decision.mandatory).toBe(false);
  });

  // The rule the notification_preferences table comment promises, and the
  // one a panel is most likely to ask to see proved.
  it("delivers every mandatory notice even when the student muted everything", () => {
    for (const type of ALWAYS_DELIVER) {
      const decision = decideDelivery({
        type,
        recipient: RECIPIENT,
        preferences: MUTED,
      });

      expect(decision.send, `${type} must ignore preferences`).toBe(true);
      expect(decision.mandatory).toBe(true);
    }
  });

  it("keeps the summons and the appeal window on the mandatory list", () => {
    // case_resolved starts the ten-day appeal clock under Sec. 9. Muting it
    // would mute the only warning that the window has opened.
    expect(ALWAYS_DELIVER.has("hearing_scheduled")).toBe(true);
    expect(ALWAYS_DELIVER.has("case_resolved")).toBe(true);
    expect(ALWAYS_DELIVER.has("appeal_window_opened")).toBe(true);
  });

  it("honours the master switch for optional mail", () => {
    const decision = decideDelivery({
      type: "announcement",
      recipient: RECIPIENT,
      preferences: { ...DEFAULT_PREFERENCES, email_enabled: false },
    });

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("email_disabled");
  });

  it("honours a single muted category without affecting the others", () => {
    const preferences = { ...DEFAULT_PREFERENCES, scholarship_alerts: false };

    expect(
      decideDelivery({ type: "scholarship_deadline", recipient: RECIPIENT, preferences })
        .reason,
    ).toBe("category_muted");

    expect(
      decideDelivery({ type: "guidance_reminder", recipient: RECIPIENT, preferences }).send,
    ).toBe(true);
  });

  it("skips an account with no address on record", () => {
    const decision = decideDelivery({
      type: "hearing_scheduled",
      recipient: null,
      preferences: DEFAULT_PREFERENCES,
    });

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("no_recipient_address");
  });

  // The guard against mailing real students from a restored or seeded
  // database. Being mandatory is a reason to override the student, never a
  // reason to override this.
  it("lets the allowlist block even a mandatory notice", () => {
    const decision = decideDelivery({
      type: "hearing_scheduled",
      recipient: RECIPIENT,
      preferences: DEFAULT_PREFERENCES,
      allowlist: ["someone.else@example.com"],
    });

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("not_allowlisted");
    expect(decision.mandatory).toBe(true);
  });

  it("matches allowlist entries regardless of case or padding", () => {
    const decision = decideDelivery({
      type: "general",
      recipient: "  TUPM-24-0123@TUP.edu.ph ",
      preferences: DEFAULT_PREFERENCES,
      allowlist: [RECIPIENT],
    });

    expect(decision.send).toBe(true);
  });

  // What the dispatcher passes when the provider only writes to the log:
  // there is no inbox to protect, so the guard is not applied.
  it("delivers normally when no allowlist is in force", () => {
    const decision = decideDelivery({
      type: "hearing_scheduled",
      recipient: RECIPIENT,
      preferences: DEFAULT_PREFERENCES,
      allowlist: null,
    });

    expect(decision.send).toBe(true);
  });

  it("treats an empty allowlist as blocking everything", () => {
    // An EMAIL_ALLOWLIST that is set but empty means "nobody", not
    // "everybody" — the safer reading of an unconfigured guard.
    const decision = decideDelivery({
      type: "general",
      recipient: RECIPIENT,
      preferences: DEFAULT_PREFERENCES,
      allowlist: [],
    });

    expect(decision.send).toBe(false);
    expect(decision.reason).toBe("not_allowlisted");
  });
});
