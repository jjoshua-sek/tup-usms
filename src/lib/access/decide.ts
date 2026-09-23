/**
 * Gate policy — pure decision logic, no database, no I/O.
 *
 * Keeping the policy pure means it can be reasoned about (and unit tested)
 * independently of Supabase: `verify.ts` gathers facts, this module turns
 * facts into a verdict, and only then is anything written.
 *
 * The QR code itself is public information (it is printed on the card), so
 * every guarantee the turnstile gives comes from the checks below.
 */

import type { IdValidationStatus } from "@/types/osa";

export type AccessDecision = "allow" | "deny";

export type AccessReason =
  | "ok"
  | "unreadable"
  | "not_found"
  | "not_validated"
  | "expired"
  | "suspended"
  | "revoked"
  | "surrendered"
  | "passback"
  | "concurrent_use"
  | "gate_inactive"
  | "duplicate_scan";

export type AccessDirection = "entry" | "exit";
export type EnforcementMode = "monitor" | "enforce";
export type AntiPassbackMode = "off" | "soft" | "hard";
export type DirectionMode = "entry" | "exit" | "bidirectional";

// ------------------------------------------------------------
// Tuning constants
// ------------------------------------------------------------

/**
 * Re-scans inside this window are treated as the same passage. Turnstiles are
 * slow and students scan twice when the arm doesn't move; without a debounce
 * the second scan would look like "entry after entry" and trip anti-passback.
 */
export const DEBOUNCE_MS = 8_000;

/**
 * The same student number appearing at a *different* gate this soon is
 * physically implausible — a screenshot of someone's Digital ID being passed
 * around, or a photocopied card.
 */
export const CONCURRENT_USE_MS = 120_000;

/**
 * Anti-passback window: two entries with no exit in between, within one
 * campus day. Long enough to catch "scan, hand the card back over the fence",
 * short enough that a forgotten exit tap doesn't haunt a student for days.
 */
export const PASSBACK_WINDOW_MS = 16 * 60 * 60 * 1000;

/** Repeated denials in a short window suggest a cloned or tampered card. */
export const REPEATED_DENIAL_WINDOW_MS = 10 * 60 * 1000;
export const REPEATED_DENIAL_THRESHOLD = 5;

// ------------------------------------------------------------
// Presentation
// ------------------------------------------------------------

export interface AccessReasonMeta {
  /** Full explanation, for staff screens and audit tables. */
  staffLabel: string;
  /** Large text on the kiosk. */
  kioskHeadline: string;
  /** Small text under the headline — what the student should do next. */
  kioskHint: string;
  tone: "success" | "warning" | "danger" | "neutral";
  /**
   * When true, the kiosk must not spell out why. Sanctions and suspicions are
   * personal information; a queue of students behind the turnstile has no
   * business learning them (RA 10173 §11, proportionality). The guard sees the
   * real reason on the staff console instead.
   */
  discreet: boolean;
}

export const ACCESS_REASON_META: Record<AccessReason, AccessReasonMeta> = {
  ok: {
    staffLabel: "Valid ID",
    kioskHeadline: "Welcome",
    kioskHint: "You may proceed.",
    tone: "success",
    discreet: false,
  },
  duplicate_scan: {
    staffLabel: "Duplicate scan (same gate, within seconds)",
    kioskHeadline: "Already scanned",
    kioskHint: "Please proceed through the turnstile.",
    tone: "success",
    discreet: false,
  },
  unreadable: {
    staffLabel: "Unreadable code — not a TUP student number",
    kioskHeadline: "Code not recognized",
    kioskHint: "Hold the QR flat inside the frame and try again.",
    tone: "warning",
    discreet: false,
  },
  not_found: {
    staffLabel: "No student record for that number",
    kioskHeadline: "ID not recognized",
    kioskHint: "Please proceed to the guard for manual verification.",
    tone: "warning",
    discreet: false,
  },
  not_validated: {
    staffLabel: "No validated ID for the current term",
    kioskHeadline: "ID not validated this term",
    kioskHint: "Visit the OSA to have your ID validated.",
    tone: "warning",
    discreet: false,
  },
  expired: {
    staffLabel: "ID validation expired",
    kioskHeadline: "ID validation expired",
    kioskHint: "Visit the OSA to renew your validation.",
    tone: "warning",
    discreet: false,
  },
  suspended: {
    staffLabel: "Campus privileges suspended",
    kioskHeadline: "Access denied",
    kioskHint: "Please see the guard on duty.",
    tone: "danger",
    discreet: true,
  },
  revoked: {
    staffLabel: "ID reported lost / revoked",
    kioskHeadline: "Access denied",
    kioskHint: "Please see the guard on duty.",
    tone: "danger",
    discreet: true,
  },
  surrendered: {
    staffLabel: "ID surrendered on clearance",
    kioskHeadline: "ID no longer active",
    kioskHint: "This ID was handed in. Please see the guard.",
    tone: "neutral",
    // Not a sanction — no need to be cagey about it.
    discreet: false,
  },
  passback: {
    staffLabel: "Anti-passback — entry with no exit recorded",
    kioskHeadline: "Access denied",
    kioskHint: "Please see the guard on duty.",
    tone: "danger",
    discreet: true,
  },
  concurrent_use: {
    staffLabel: "Same ID used at another gate moments ago",
    kioskHeadline: "Access denied",
    kioskHint: "Please see the guard on duty.",
    tone: "danger",
    discreet: true,
  },
  gate_inactive: {
    staffLabel: "Gate is deactivated",
    kioskHeadline: "Gate closed",
    kioskHint: "This lane is not in service.",
    tone: "neutral",
    discreet: false,
  },
};

// ------------------------------------------------------------
// Policy
// ------------------------------------------------------------

export interface ValidationFacts {
  status: IdValidationStatus | null;
  /** ISO timestamp, or null when OSA left the expiry open. */
  expiresAt: string | null;
}

export interface PriorEvent {
  gateId: string | null;
  direction: AccessDirection;
  decision: AccessDecision;
  occurredAt: string;
}

export interface PolicyFacts {
  gate: {
    id: string | null;
    isActive: boolean;
    enforcementMode: EnforcementMode;
    antiPassback: AntiPassbackMode;
  };
  direction: AccessDirection;
  /** False when the scanned payload was not a student number at all. */
  parsed: boolean;
  studentFound: boolean;
  validation: ValidationFacts | null;
  /** Most recent turnstile event for this student, any gate. */
  lastEvent: PriorEvent | null;
  /** Most recent *allowed* turnstile event for this student, any gate. */
  lastAllowed: PriorEvent | null;
  now: Date;
}

export interface PolicyVerdict {
  decision: AccessDecision;
  reason: AccessReason;
  /**
   * Anomalies to record. Recorded even when the scan is allowed — a soft
   * anti-passback gate lets the student through *and* files the signal.
   */
  anomalies: Array<{
    type:
      | "concurrent_use"
      | "passback_violation"
      | "repeated_denials"
      | "scan_while_suspended";
    severity: "low" | "medium" | "high";
    details: Record<string, unknown>;
  }>;
}

function msSince(iso: string, now: Date): number {
  return now.getTime() - new Date(iso).getTime();
}

export function decideAccess(facts: PolicyFacts): PolicyVerdict {
  const anomalies: PolicyVerdict["anomalies"] = [];
  const deny = (reason: AccessReason): PolicyVerdict => ({
    decision: "deny",
    reason,
    anomalies,
  });

  if (!facts.gate.isActive) return deny("gate_inactive");
  if (!facts.parsed) return deny("unreadable");
  if (!facts.studentFound) return deny("not_found");

  // ---- Debounce: treat an immediate re-scan as the same passage ----
  const last = facts.lastEvent;
  if (
    last &&
    last.decision === "allow" &&
    last.gateId === facts.gate.id &&
    last.direction === facts.direction &&
    msSince(last.occurredAt, facts.now) < DEBOUNCE_MS
  ) {
    return { decision: "allow", reason: "duplicate_scan", anomalies };
  }

  // ---- ID validation state ----
  const status = facts.validation?.status ?? null;

  if (status === "suspended" || status === "revoked") {
    anomalies.push({
      type: "scan_while_suspended",
      severity: "high",
      details: { status, gate_id: facts.gate.id, direction: facts.direction },
    });
    return deny(status);
  }

  // A surrendered ID is a graduate's, not an offender's — denied, but it
  // raises no anomaly and gets no discreet treatment.
  if (status === "surrendered") return deny("surrendered");

  if (status !== "validated") {
    // pending / under_review / rejected / missing all mean "not validated yet".
    return deny(status === "expired" ? "expired" : "not_validated");
  }

  const expiresAt = facts.validation?.expiresAt;
  if (expiresAt && new Date(expiresAt).getTime() <= facts.now.getTime()) {
    return deny("expired");
  }

  // ---- Concurrent use: same code, different gate, seconds apart ----
  const lastAllowed = facts.lastAllowed;
  if (
    lastAllowed &&
    lastAllowed.gateId &&
    lastAllowed.gateId !== facts.gate.id &&
    msSince(lastAllowed.occurredAt, facts.now) < CONCURRENT_USE_MS
  ) {
    anomalies.push({
      type: "concurrent_use",
      severity: "high",
      details: {
        previous_gate_id: lastAllowed.gateId,
        seconds_apart: Math.round(msSince(lastAllowed.occurredAt, facts.now) / 1000),
        gate_id: facts.gate.id,
      },
    });
    // Always denied: one person cannot be at two gates at once, so at least
    // one of the two scans is not the cardholder.
    return deny("concurrent_use");
  }

  // ---- Anti-passback: entry after entry, no exit in between ----
  if (
    facts.gate.antiPassback !== "off" &&
    facts.direction === "entry" &&
    lastAllowed &&
    lastAllowed.direction === "entry" &&
    msSince(lastAllowed.occurredAt, facts.now) < PASSBACK_WINDOW_MS
  ) {
    anomalies.push({
      type: "passback_violation",
      severity: facts.gate.antiPassback === "hard" ? "high" : "medium",
      details: {
        previous_gate_id: lastAllowed.gateId,
        minutes_apart: Math.round(msSince(lastAllowed.occurredAt, facts.now) / 60000),
        mode: facts.gate.antiPassback,
      },
    });

    if (facts.gate.antiPassback === "hard") return deny("passback");
    // Soft mode: let them in, flag it for OSA. Real exits are often missed
    // because only some lanes have exit readers.
  }

  return { decision: "allow", reason: "ok", anomalies };
}

/**
 * Monitor mode records the verdict but never holds anyone at the arm. This is
 * how a gate is rolled out: watch a week of real traffic, fix the data
 * problems it exposes, *then* switch to enforce.
 */
export function shouldOpenGate(
  verdict: PolicyVerdict,
  enforcementMode: EnforcementMode,
  gateIsActive: boolean,
): boolean {
  if (!gateIsActive) return false;
  if (verdict.decision === "allow") return true;
  return enforcementMode === "monitor" && verdict.reason !== "gate_inactive";
}
