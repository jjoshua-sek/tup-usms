import { describe, expect, it } from "vitest";

import { finalPolicies } from "@/lib/testing/migrations";

import { ACCOUNT_ACTIVITY_ACTIONS, describeActivity, describeUserAgent } from "./activity";

describe("own account activity, as the migrations allow it", () => {
  const policy = finalPolicies("audit_logs").get("users read own account activity");

  it("lets a user read only their own rows", () => {
    expect(policy?.command).toBe("SELECT");
    expect(policy?.using).toMatch(/user_id = auth\.uid\(\)/);
  });

  it("allows exactly the actions Settings knows how to show", () => {
    const allowed = [...(policy?.using.matchAll(/'(\w+)'/g) ?? [])].map((match) => match[1]).sort();
    expect(allowed).toEqual([...ACCOUNT_ACTIVITY_ACTIONS].sort());
  });
});

describe("describeActivity", () => {
  const row = (action: string, details: object | null = null) => ({
    action,
    details: details ? JSON.stringify(details) : null,
    ip_address: "203.0.113.7",
    user_agent: null,
    created_at: "2026-10-07T01:00:00Z",
  });

  it("tells a reset link from a first-time setup link", () => {
    expect(describeActivity(row("account_activated", { purpose: "reset" })).label).toMatch(/reset link/);
    expect(describeActivity(row("account_activated", { purpose: "setup" })).label).toMatch(/set up/);
  });

  it("says when someone asked for a reset with an email that didn't match", () => {
    expect(describeActivity(row("password_reset_requested", { outcome: "email_mismatch" })).note).toMatch(/didn't match/);
  });

  it("survives details that are not JSON", () => {
    expect(describeActivity({ ...row("password_reset_requested"), details: "not json" }).note).toBe("No link sent");
  });
});

describe("describeUserAgent", () => {
  it("names common browsers and systems", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
  });

  it("does not guess when there is nothing to go on", () => {
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("unknown")).toBe("Unknown device");
  });
});
