import { describe, expect, it } from "vitest";

import { RESEND_COOLDOWN_MS, planSelfReset, type InvitationForReset } from "./self-reset";

const now = new Date("2026-10-07T08:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const invitation = (overrides: Partial<InvitationForReset> = {}): InvitationForReset => ({
  status: "activated",
  delivery_email: "Juan.DelaCruz@example.com",
  sent_at: minutesAgo(60 * 24 * 30),
  link_purpose: "setup",
  ...overrides,
});

describe("planSelfReset", () => {
  it("sends a reset to a set-up account when the email matches, ignoring case and spaces", () => {
    expect(planSelfReset({ invitation: invitation(), email: "  juan.delacruz@EXAMPLE.com ", now })).toEqual({
      action: "queue",
      purpose: "reset",
    });
  });

  it("treats an account given a password by the administrator as set up", () => {
    expect(planSelfReset({ invitation: invitation({ status: "password_issued" }), email: "juan.delacruz@example.com", now })).toEqual({
      action: "queue",
      purpose: "reset",
    });
  });

  it("sends nothing when the email is not the one on the enrollment record", () => {
    expect(planSelfReset({ invitation: invitation(), email: "someone.else@example.com", now })).toEqual({
      action: "ignore",
      reason: "email_mismatch",
    });
  });

  it("sends nothing for an account with no invitation", () => {
    expect(planSelfReset({ invitation: null, email: "juan.delacruz@example.com", now })).toEqual({
      action: "ignore",
      reason: "no_invitation",
    });
  });

  it("does not queue a second link while one is queued or being sent", () => {
    for (const status of ["queued", "sending"]) {
      expect(planSelfReset({ invitation: invitation({ status }), email: "juan.delacruz@example.com", now })).toEqual({
        action: "ignore",
        reason: "already_queued",
      });
    }
  });

  it("does not resend a link sent within the cooldown", () => {
    const recent = invitation({ status: "sent", link_purpose: "reset", sent_at: minutesAgo(3) });
    expect(planSelfReset({ invitation: recent, email: "juan.delacruz@example.com", now })).toEqual({
      action: "ignore",
      reason: "sent_recently",
    });
  });

  it("resends an unused link once the cooldown has passed, keeping its purpose", () => {
    const sentAt = new Date(now.getTime() - RESEND_COOLDOWN_MS - 1000).toISOString();
    expect(
      planSelfReset({
        invitation: invitation({ status: "sent", link_purpose: "reset", sent_at: sentAt }),
        email: "juan.delacruz@example.com",
        now,
      }),
    ).toEqual({ action: "queue", purpose: "reset" });
  });

  it("resends a first-time setup link to a student who never finished setting up", () => {
    for (const status of ["sent", "failed", "undeliverable"]) {
      expect(
        planSelfReset({
          invitation: invitation({ status, link_purpose: "setup", sent_at: minutesAgo(120) }),
          email: "juan.delacruz@example.com",
          now,
        }),
      ).toEqual({ action: "queue", purpose: "setup" });
    }
  });

  it("assumes a setup link when the purpose column is missing (before migration 00022)", () => {
    expect(
      planSelfReset({
        invitation: invitation({ status: "failed", link_purpose: undefined }),
        email: "juan.delacruz@example.com",
        now,
      }),
    ).toEqual({ action: "queue", purpose: "setup" });
  });
});
