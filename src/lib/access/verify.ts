/**
 * Scan verification — the one place a QR scan turns into a verdict.
 *
 * Shared by the unattended gate kiosk (`POST /api/access/verify`) and the OSA
 * front-desk scanner (a Server Action), so the two can never disagree about
 * what a valid ID is.
 *
 * Flow:
 *   parse payload → find student → find this term's ID validation
 *   → read recent history → decide (pure) → append event → file anomalies
 *
 * Runs with the service-role client because the caller is a device, not a
 * signed-in user: there is no JWT for RLS to evaluate. Everything this module
 * returns is deliberately narrow — see `AccessDisplay`.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import type { IdValidationStatus } from "@/types/osa";

import {
  ACCESS_REASON_META,
  decideAccess,
  shouldOpenGate,
  REPEATED_DENIAL_THRESHOLD,
  REPEATED_DENIAL_WINDOW_MS,
  type AccessDecision,
  type AccessDirection,
  type AccessReason,
  type AntiPassbackMode,
  type DirectionMode,
  type EnforcementMode,
  type PriorEvent,
} from "./decide";
import { maskStudentNumber, parseInstitutionalQr, shortDisplayName } from "./payload";
import { getCurrentTerm } from "./term";

export interface AccessGate {
  id: string;
  code: string;
  name: string;
  location: string | null;
  direction_mode: DirectionMode;
  enforcement_mode: EnforcementMode;
  anti_passback: AntiPassbackMode;
  relay_mode: "none" | "local_http" | "web_serial";
  relay_config: Record<string, unknown>;
  is_active: boolean;
}

export interface VerifyScanInput {
  /** Raw text the scanner produced. */
  payload: string;
  /** The turnstile lane, or null for the OSA desk. */
  gate: AccessGate | null;
  context: "turnstile" | "osa_desk";
  direction?: AccessDirection;
  /** Signed-in staff user id — desk scans only. */
  scannedBy?: string | null;
  /** Label to store when there is no gate row (e.g. "OSA Front Desk"). */
  deskLabel?: string;
  /** For latency measurement; pass Date.now() at the top of the handler. */
  startedAt?: number;
}

/** Everything the kiosk screen is allowed to know. */
export interface AccessDisplay {
  name: string;
  maskedNumber: string;
  photoUrl: string | null;
  program: string | null;
  yearLevel: string | null;
}

export interface VerifyScanResult {
  decision: AccessDecision;
  reason: AccessReason;
  /** Whether the turnstile should actually open (monitor mode opens anyway). */
  gateOpened: boolean;
  /** False when the gate is in monitor mode and the verdict was "deny". */
  enforced: boolean;
  headline: string;
  hint: string;
  tone: "success" | "warning" | "danger" | "neutral";
  student: AccessDisplay | null;
  eventId: string | null;
  anomalyFlagged: boolean;
  termLabel: string;
  /** Staff-desk extras. Never sent to a kiosk. */
  staffDetail?: {
    studentId: string | null;
    fullName: string | null;
    studentNumber: string | null;
    validationStatus: IdValidationStatus | null;
    validationTerm: string | null;
    expiresAt: string | null;
  };
}

interface StudentRow {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  program: string | null;
  year_level: string | null;
  photo_url: string | null;
}

interface ValidationRow {
  id: string;
  status: IdValidationStatus;
  school_year: string;
  semester: string;
  expires_at: string | null;
}

export async function verifyScan(input: VerifyScanInput): Promise<VerifyScanResult> {
  const startedAt = input.startedAt ?? Date.now();
  const now = new Date();
  const term = getCurrentTerm(now);
  // New tables aren't in the hand-maintained Database generic yet, so the
  // typed query builder would collapse them to `never`.
  const db = loose(createAdminClient());

  const direction: AccessDirection =
    input.direction ?? (input.gate?.direction_mode === "exit" ? "exit" : "entry");
  const gateLabel =
    input.gate?.name ?? input.deskLabel ?? (input.context === "osa_desk" ? "OSA Desk" : "Unknown gate");

  const parsed = parseInstitutionalQr(input.payload);

  // ---- 1. Student ----
  let student: StudentRow | null = null;
  if (parsed.studentNumber) {
    const { data } = await db
      .from("students")
      .select("id, student_number, first_name, last_name, program, year_level, photo_url")
      .eq("student_number", parsed.studentNumber)
      .maybeSingle();
    student = (data as StudentRow | null) ?? null;
  }

  // ---- 2. ID validation for the current term ----
  let validation: ValidationRow | null = null;
  if (student) {
    const { data } = await db
      .from("id_validations")
      .select("id, status, school_year, semester, expires_at")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false })
      .limit(6);

    const rows = (data as ValidationRow[] | null) ?? [];
    validation =
      rows.find((r) => r.school_year === term.schoolYear && r.semester === term.semester) ??
      // Fall back to any still-valid validation, so a term label typed
      // slightly differently by OSA doesn't lock students out of campus.
      rows.find(
        (r) =>
          r.status === "validated" &&
          (!r.expires_at || new Date(r.expires_at).getTime() > now.getTime()),
      ) ??
      rows[0] ??
      null;
  }

  // ---- 3. Recent history (turnstile only) ----
  let lastEvent: PriorEvent | null = null;
  let lastAllowed: PriorEvent | null = null;

  if (student && input.context === "turnstile") {
    const { data } = await db
      .from("access_events")
      .select("gate_id, direction, decision, occurred_at")
      .eq("student_id", student.id)
      .eq("context", "turnstile")
      .order("occurred_at", { ascending: false })
      .limit(10);

    const history = ((data as Array<{
      gate_id: string | null;
      direction: AccessDirection;
      decision: AccessDecision;
      occurred_at: string;
    }> | null) ?? []).map<PriorEvent>((row) => ({
      gateId: row.gate_id,
      direction: row.direction,
      decision: row.decision,
      occurredAt: row.occurred_at,
    }));

    lastEvent = history[0] ?? null;
    lastAllowed = history.find((e) => e.decision === "allow") ?? null;
  }

  // ---- 4. Decide ----
  const verdict = decideAccess({
    gate: {
      id: input.gate?.id ?? null,
      // The desk is always "active"; only physical lanes can be taken offline.
      isActive: input.gate ? input.gate.is_active : true,
      enforcementMode: input.gate?.enforcement_mode ?? "enforce",
      // Passback is meaningless at a desk.
      antiPassback: input.context === "turnstile" ? input.gate?.anti_passback ?? "soft" : "off",
    },
    direction,
    parsed: parsed.ok,
    studentFound: Boolean(student),
    validation: validation
      ? { status: validation.status, expiresAt: validation.expires_at }
      : null,
    lastEvent,
    lastAllowed,
    now,
  });

  const gateOpened =
    input.context === "turnstile"
      ? shouldOpenGate(verdict, input.gate?.enforcement_mode ?? "enforce", input.gate?.is_active ?? false)
      : false;
  const enforced =
    input.context !== "turnstile" ||
    verdict.decision === "allow" ||
    (input.gate?.enforcement_mode ?? "enforce") === "enforce";

  // ---- 5. Append the event ----
  let eventId: string | null = null;
  const { data: inserted } = await db
    .from("access_events")
    .insert({
      gate_id: input.gate?.id ?? null,
      gate_label: gateLabel,
      context: input.context,
      student_id: student?.id ?? null,
      id_validation_id: validation?.id ?? null,
      // Truncated: enough to debug a misprinted card, not a free-form log sink.
      scanned_payload: input.payload.slice(0, 64),
      normalized_student_number: parsed.studentNumber,
      direction,
      decision: verdict.decision,
      enforced,
      gate_opened: gateOpened,
      reason: verdict.reason,
      latency_ms: Math.max(0, Date.now() - startedAt),
      scanned_by: input.scannedBy ?? null,
    })
    .select("id")
    .maybeSingle();
  eventId = (inserted as { id: string } | null)?.id ?? null;

  // ---- 6. Anomalies ----
  const anomalies = [...verdict.anomalies];

  if (verdict.decision === "deny" && parsed.studentNumber) {
    const since = new Date(now.getTime() - REPEATED_DENIAL_WINDOW_MS).toISOString();
    const { count } = await db
      .from("access_events")
      .select("id", { count: "exact", head: true })
      .eq("normalized_student_number", parsed.studentNumber)
      .eq("decision", "deny")
      .gte("occurred_at", since);

    if ((count ?? 0) >= REPEATED_DENIAL_THRESHOLD) {
      anomalies.push({
        type: "repeated_denials",
        severity: "medium",
        details: { denials: count, window_minutes: REPEATED_DENIAL_WINDOW_MS / 60000 },
      });
    }
  }

  for (const anomaly of anomalies) {
    await db.rpc("record_access_anomaly", {
      p_student_id: student?.id ?? null,
      p_student_number: parsed.studentNumber,
      p_type: anomaly.type,
      p_severity: anomaly.severity,
      p_details: { ...anomaly.details, gate_label: gateLabel, reason: verdict.reason },
      p_event_id: eventId,
    });
  }

  // ---- 7. Shape the response ----
  const meta = ACCESS_REASON_META[verdict.reason];

  // A denied scan shows no identity at all: if the card isn't the bearer's,
  // the screen must not confirm whose it is.
  const display: AccessDisplay | null =
    student && verdict.decision === "allow"
      ? {
          name: shortDisplayName(student.first_name, student.last_name),
          maskedNumber: maskStudentNumber(student.student_number),
          photoUrl: student.photo_url,
          program: student.program,
          yearLevel: student.year_level,
        }
      : null;

  const result: VerifyScanResult = {
    decision: verdict.decision,
    reason: verdict.reason,
    gateOpened,
    enforced,
    headline: meta.kioskHeadline,
    hint: meta.kioskHint,
    tone: meta.tone,
    student: display,
    eventId,
    anomalyFlagged: anomalies.length > 0,
    termLabel: term.label,
  };

  if (input.context === "osa_desk") {
    result.staffDetail = {
      studentId: student?.id ?? null,
      fullName: student ? `${student.first_name} ${student.last_name}`.trim() : null,
      studentNumber: student?.student_number ?? null,
      validationStatus: validation?.status ?? null,
      validationTerm: validation ? `${validation.semester}, ${validation.school_year}` : null,
      expiresAt: validation?.expires_at ?? null,
    };
    // At the desk, staff need the real reason spelled out.
    result.headline = verdict.decision === "allow" ? "Valid ID" : "Not valid";
    result.hint = meta.staffLabel;
  }

  return result;
}
