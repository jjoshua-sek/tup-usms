import { describe, expect, it } from "vitest";

import { decideAccess, type PolicyFacts } from "./decide";

const now = new Date("2026-10-14T00:30:00Z");

const facts = (overrides: Partial<PolicyFacts> = {}): PolicyFacts => ({
  gate: { id: "gate-1", isActive: true, enforcementMode: "enforce", antiPassback: "soft" },
  direction: "entry",
  parsed: true,
  studentFound: true,
  validation: { status: "validated", expiresAt: "2026-12-20T15:59:59Z" },
  lastEvent: null,
  lastAllowed: null,
  now,
  ...overrides,
});

describe("decideAccess", () => {
  it("lets a validated ID through", () => {
    expect(decideAccess(facts())).toMatchObject({ decision: "allow", reason: "ok", anomalies: [] });
  });

  // The OSA asked to be told and step in itself rather than have the gate
  // turn a suspended student away.
  it("lets a suspended ID through and flags it for the OSA", () => {
    const verdict = decideAccess(facts({ validation: { status: "suspended", expiresAt: "2026-12-20T15:59:59Z" } }));
    expect(verdict.decision).toBe("allow");
    expect(verdict.reason).toBe("suspended");
    expect(verdict.anomalies).toEqual([
      expect.objectContaining({ type: "scan_while_suspended", severity: "high", details: expect.objectContaining({ status: "suspended" }) }),
    ]);
  });

  it("still applies the later checks to a suspended ID", () => {
    const expired = decideAccess(facts({ validation: { status: "suspended", expiresAt: "2026-10-01T00:00:00Z" } }));
    expect(expired).toMatchObject({ decision: "deny", reason: "expired" });
    expect(expired.anomalies.map((a) => a.type)).toEqual(["scan_while_suspended"]);

    const elsewhere = decideAccess(
      facts({
        validation: { status: "suspended", expiresAt: null },
        lastAllowed: { gateId: "gate-2", direction: "entry", decision: "allow", occurredAt: "2026-10-14T00:29:30Z" },
      }),
    );
    expect(elsewhere).toMatchObject({ decision: "deny", reason: "concurrent_use" });
  });

  // A revoked card was reported lost or stolen: whoever holds it is
  // probably not its owner.
  it("refuses a revoked ID and flags it", () => {
    const verdict = decideAccess(facts({ validation: { status: "revoked", expiresAt: null } }));
    expect(verdict).toMatchObject({ decision: "deny", reason: "revoked" });
    expect(verdict.anomalies.map((a) => a.type)).toEqual(["scan_while_suspended"]);
  });

  it("refuses an ID not validated this term, without an anomaly", () => {
    expect(decideAccess(facts({ validation: null }))).toMatchObject({ decision: "deny", reason: "not_validated", anomalies: [] });
    expect(decideAccess(facts({ validation: { status: "surrendered", expiresAt: null } }))).toMatchObject({
      decision: "deny",
      reason: "surrendered",
    });
  });
});
