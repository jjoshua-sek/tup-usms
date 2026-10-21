/**
 * What the offline LAN copy uploads, and how the cloud judges each record
 * (offline fallback plan, Phase 2). Pure, so the rules can be tested; the
 * route is app/api/offline/upload and the applying is lib/offline/apply.ts.
 *
 * Two kinds of record come up from the copy's outbox:
 *
 *   gate_scan      a turnstile scan decided on the copy. The cloud records
 *                  it at the time it happened and checks it again against
 *                  what only the cloud knew: a suspension issued after the
 *                  copy's last refresh, a scan at a gate still on the cloud.
 *   id_validation  "Validate at the counter" done on the copy. The cloud
 *                  applies it unless its own record changed meanwhile in a
 *                  way a sticker must not override (suspended, revoked,
 *                  surrendered): those wait on a review list instead.
 */

import { z } from "zod";

import { CONCURRENT_USE_MS, PASSBACK_WINDOW_MS, type PriorEvent } from "@/lib/access/decide";
import type { IdValidationStatus } from "@/types/osa";

const gateScanPayload = z.object({
  /** The kiosk's id for the scan; absent from copies and kiosks older than migration 00035. */
  scan_id: z.string().uuid().nullable().optional(),
  student_number: z.string().max(40).nullable(),
  scanned_payload: z.string().max(64).nullable(),
  gate_id: z.string().uuid().nullable(),
  gate_label: z.string().max(120),
  direction: z.enum(["entry", "exit"]),
  decision: z.enum(["allow", "deny"]),
  reason: z.string().max(40),
  gate_opened: z.boolean(),
  enforced: z.boolean(),
});

const idValidationPayload = z.object({
  student_id: z.string().uuid(),
  student_number: z.string().max(40),
  school_year: z.string().max(20),
  semester: z.string().max(30),
  sticker_number: z.string().max(40).nullable(),
  validated_by_staff_id: z.string().uuid(),
  validated_by_user_id: z.string().uuid(),
});

export const uploadRecordSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().uuid(), kind: z.literal("gate_scan"), occurred_at: z.string().datetime({ offset: true }), payload: gateScanPayload }),
  z.object({ id: z.string().uuid(), kind: z.literal("id_validation"), occurred_at: z.string().datetime({ offset: true }), payload: idValidationPayload }),
]);

/** At most this many records per request; the copy sends its outbox in batches. */
export const MAX_UPLOAD_BATCH = 100;

export const uploadBodySchema = z.object({ records: z.array(uploadRecordSchema).min(1).max(MAX_UPLOAD_BATCH) });

export type UploadRecord = z.infer<typeof uploadRecordSchema>;
export type GateScanUpload = Extract<UploadRecord, { kind: "gate_scan" }>;
export type IdValidationUpload = Extract<UploadRecord, { kind: "id_validation" }>;

export type UploadOutcome = "applied" | "conflict" | "rejected";

/** A record older than this is refused: a copy that sat unplugged for weeks should not rewrite history. */
export const MAX_UPLOAD_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** What the review list and the receipts read from offline_uploads. */
export const OFFLINE_UPLOAD_COLUMNS = "id, kind, occurred_at, received_at, payload, outcome, detail, review_status, students(first_name, last_name, student_number)";

/** The counter may complete these, exactly as validateAtCounter does online. */
const COUNTER_CAN_VALIDATE = new Set<IdValidationStatus>(["pending", "under_review", "rejected", "expired"]);

/**
 * What to do with an ID validated at the counter while offline, given the
 * cloud's record for that student and term as it stands now.
 */
export function planUploadedValidation(cloudStatus: IdValidationStatus | null): "validate" | "already_validated" | "conflict" {
  if (cloudStatus === null || COUNTER_CAN_VALIDATE.has(cloudStatus)) return "validate";
  if (cloudStatus === "validated") return "already_validated";
  return "conflict"; // suspended, revoked, surrendered
}

export interface RecheckAnomaly {
  type: "concurrent_use" | "passback_violation";
  severity: "medium" | "high";
  details: Record<string, unknown>;
}

/**
 * Checks an uploaded scan again against the cloud's own history around the
 * time it happened: the copy could not see scans at gates still on the
 * cloud. Flags only; the student was already let through or not.
 */
export function recheckUploadedScan(
  scan: { gateId: string | null; direction: "entry" | "exit"; decision: "allow" | "deny"; occurredAt: string },
  cloudHistory: PriorEvent[],
): RecheckAnomaly[] {
  if (scan.decision !== "allow") return [];
  const at = new Date(scan.occurredAt).getTime();
  const allowed = cloudHistory.filter((event) => event.decision === "allow");
  const anomalies: RecheckAnomaly[] = [];

  const elsewhere = allowed.find(
    (event) =>
      event.gateId &&
      event.gateId !== scan.gateId &&
      Math.abs(new Date(event.occurredAt).getTime() - at) < CONCURRENT_USE_MS,
  );
  if (elsewhere) {
    anomalies.push({
      type: "concurrent_use",
      severity: "high",
      details: {
        previous_gate_id: elsewhere.gateId,
        seconds_apart: Math.round(Math.abs(new Date(elsewhere.occurredAt).getTime() - at) / 1000),
        gate_id: scan.gateId,
        recorded_offline: true,
      },
    });
  }

  if (scan.direction === "entry") {
    // The most recent allowed pass before this one, on any gate.
    const before = allowed
      .filter((event) => new Date(event.occurredAt).getTime() < at)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
    if (before && before.direction === "entry" && at - new Date(before.occurredAt).getTime() < PASSBACK_WINDOW_MS) {
      anomalies.push({
        type: "passback_violation",
        severity: "medium",
        details: {
          previous_gate_id: before.gateId,
          minutes_apart: Math.round((at - new Date(before.occurredAt).getTime()) / 60000),
          recorded_offline: true,
        },
      });
    }
  }
  return anomalies;
}

/** "Oct 21, 10:47 AM": when something happened offline, in Manila time. */
export function offlineMoment(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
