import "server-only";

import type { PriorEvent } from "@/lib/access/decide";
import { alertOsaOfGateAnomaly } from "@/lib/access/alerts";
import { defaultTermExpiry, getCurrentTerm } from "@/lib/access/term";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose, type LooseClient } from "@/lib/supabase/loose";
import { logSystemAuditEvent } from "@/lib/utils/audit";
import type { IdValidationStatus } from "@/types/osa";

import {
  MAX_UPLOAD_AGE_MS,
  offlineMoment,
  planUploadedValidation,
  recheckUploadedScan,
  type GateScanUpload,
  type IdValidationUpload,
  type UploadOutcome,
  type UploadRecord,
} from "./upload-rules";

/**
 * Applies records uploaded from the offline LAN copy, each checked with the
 * cloud's own rules. The rules are in upload-rules.ts; this does the reading
 * and writing.
 *
 * Every record is applied at most once. Its outbox id is the key of its
 * receipt in offline_uploads: a record sent again (the connection dropped
 * before the copy heard back) gets the first answer back, and nothing is
 * written twice.
 */

export interface UploadResult {
  id: string;
  /** "retry": not applied and not recorded; the copy sends it again later. */
  outcome: UploadOutcome | "retry";
  detail: string;
}

export async function applyUploads(records: UploadRecord[], now = new Date()): Promise<UploadResult[]> {
  const db = loose(createAdminClient());
  const results: UploadResult[] = [];

  for (const record of records) {
    const { data: receipt } = await db.from("offline_uploads").select("outcome, detail").eq("id", record.id).maybeSingle();
    if (receipt) {
      const r = receipt as { outcome: UploadOutcome; detail: string | null };
      results.push({ id: record.id, outcome: r.outcome, detail: r.detail ?? "" });
      continue;
    }

    let result: { outcome: UploadOutcome; detail: string; studentId: string | null; review: boolean };
    try {
      if (now.getTime() - new Date(record.occurred_at).getTime() > MAX_UPLOAD_AGE_MS) {
        result = { outcome: "rejected", detail: "Older than 14 days; not applied.", studentId: null, review: false };
      } else if (record.kind === "gate_scan") {
        result = await applyGateScan(db, record);
      } else {
        result = await applyIdValidation(db, record);
      }
    } catch (error) {
      // Not recorded: the copy keeps the record and sends it again.
      console.error("[offline upload] could not apply", record.id, error);
      results.push({ id: record.id, outcome: "retry", detail: "Could not be applied just now; it will be sent again." });
      continue;
    }

    const { error: receiptError } = await db.from("offline_uploads").insert({
      id: record.id,
      kind: record.kind,
      occurred_at: record.occurred_at,
      payload: record.payload,
      outcome: result.outcome,
      detail: result.detail,
      student_id: result.studentId,
      review_status: result.review ? "open" : "none",
    });
    if (receiptError) console.error("[offline upload] receipt not saved", record.id, receiptError);
    results.push({ id: record.id, outcome: result.outcome, detail: result.detail });
  }
  return results;
}

async function findStudent(db: LooseClient, by: { id?: string; number?: string | null }) {
  if (!by.id && !by.number) return null;
  const query = db.from("students").select("id, user_id, student_number, first_name, last_name");
  const { data } = await (by.id ? query.eq("id", by.id) : query.eq("student_number", by.number)).maybeSingle();
  return data as { id: string; user_id: string; student_number: string; first_name: string; last_name: string } | null;
}

async function termValidation(db: LooseClient, studentId: string, at: Date) {
  const term = getCurrentTerm(at);
  const { data } = await db
    .from("id_validations")
    .select("id, status")
    .eq("student_id", studentId)
    .eq("school_year", term.schoolYear)
    .eq("semester", term.semester)
    .maybeSingle();
  return { term, row: data as { id: string; status: IdValidationStatus } | null };
}

async function applyGateScan(db: LooseClient, record: GateScanUpload) {
  const scan = record.payload;
  const at = new Date(record.occurred_at);
  const student = await findStudent(db, { number: scan.student_number });

  // The cloud's history around the scan, before it is added.
  let history: PriorEvent[] = [];
  if (student) {
    const { data } = await db
      .from("access_events")
      .select("gate_id, direction, decision, occurred_at")
      .eq("student_id", student.id)
      .eq("context", "turnstile")
      .gte("occurred_at", new Date(at.getTime() - 16 * 60 * 60 * 1000).toISOString())
      .lte("occurred_at", new Date(at.getTime() + 5 * 60 * 1000).toISOString());
    history = ((data as Array<{ gate_id: string | null; direction: "entry" | "exit"; decision: "allow" | "deny"; occurred_at: string }> | null) ?? []).map(
      (row) => ({ gateId: row.gate_id, direction: row.direction, decision: row.decision, occurredAt: row.occurred_at }),
    );
  }

  const validation = student ? await termValidation(db, student.id, at) : null;
  const { data: gateRow } = scan.gate_id ? await db.from("access_gates").select("id").eq("id", scan.gate_id).maybeSingle() : { data: null };

  const { data: inserted, error } = await db
    .from("access_events")
    .insert({
      gate_id: gateRow ? scan.gate_id : null,
      gate_label: scan.gate_label,
      context: "turnstile",
      student_id: student?.id ?? null,
      id_validation_id: validation?.row?.id ?? null,
      scanned_payload: scan.scanned_payload,
      normalized_student_number: scan.student_number,
      direction: scan.direction,
      decision: scan.decision,
      enforced: scan.enforced,
      gate_opened: scan.gate_opened,
      reason: scan.reason,
      occurred_at: record.occurred_at,
      recorded_offline: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  const eventId = (inserted as { id: string }).id;

  const anomalies: Array<{ type: string; severity: string; details: Record<string, unknown> }> = [
    ...recheckUploadedScan({ gateId: scan.gate_id, direction: scan.direction, decision: scan.decision, occurredAt: record.occurred_at }, history),
  ];
  // What the cloud knows now and the copy may not have: a suspension or a
  // lost-card report made after the copy's last refresh.
  const cloudStatus = validation?.row?.status ?? null;
  const flaggedStatus =
    cloudStatus === "suspended" || cloudStatus === "revoked"
      ? cloudStatus
      : scan.reason === "suspended" || scan.reason === "revoked"
        ? scan.reason
        : null;
  if (flaggedStatus) {
    anomalies.push({ type: "scan_while_suspended", severity: "high", details: { status: flaggedStatus, gate_id: scan.gate_id, direction: scan.direction, recorded_offline: true } });
  }

  const when = offlineMoment(record.occurred_at);
  for (const anomaly of anomalies) {
    const { data: anomalyId } = await db.rpc("record_access_anomaly", {
      p_student_id: student?.id ?? null,
      p_student_number: scan.student_number,
      p_type: anomaly.type,
      p_severity: anomaly.severity,
      p_details: { ...anomaly.details, gate_label: scan.gate_label, reason: scan.reason, offline_at: record.occurred_at },
      p_event_id: eventId,
    });
    if (anomaly.type === "scan_while_suspended" && typeof anomalyId === "string" && flaggedStatus) {
      await alertOsaOfGateAnomaly(db, {
        anomalyId,
        status: flaggedStatus,
        studentName: student ? `${student.first_name} ${student.last_name}`.trim() : null,
        studentNumber: student?.student_number ?? scan.student_number,
        gateLabel: scan.gate_label,
        letThrough: scan.decision === "allow",
        offlineAt: when,
      }).catch((alertError: unknown) => console.error("[offline upload] alert failed", alertError));
    }
  }

  const flags = anomalies.map((a) => a.type).join(", ");
  return {
    outcome: "applied" as const,
    detail: `Scan at ${scan.gate_label} on ${when} recorded${flags ? `; flagged: ${flags}` : ""}.`,
    studentId: student?.id ?? null,
    review: false,
  };
}

async function applyIdValidation(db: LooseClient, record: IdValidationUpload) {
  const p = record.payload;
  const at = new Date(record.occurred_at);
  const when = offlineMoment(record.occurred_at);
  const student = await findStudent(db, { id: p.student_id });
  if (!student) return { outcome: "rejected" as const, detail: `No student ${p.student_number} in the cloud.`, studentId: null, review: false };

  const { term, row } = await termValidation(db, student.id, at);
  const plan = planUploadedValidation(row?.status ?? null);

  if (plan === "already_validated") {
    return { outcome: "applied" as const, detail: `Already validated in the cloud; nothing to change.`, studentId: student.id, review: false };
  }
  if (plan === "conflict") {
    return {
      outcome: "conflict" as const,
      detail: `Validated at the counter on ${when} while offline, but the cloud record is ${row?.status}. Not applied: decide whether to reinstate.`,
      studentId: student.id,
      review: true,
    };
  }

  const validated = {
    status: "validated",
    rejection_reason: null,
    validated_by: p.validated_by_staff_id,
    validated_at: record.occurred_at,
    expires_at: defaultTermExpiry(term).toISOString(),
    ...(p.sticker_number ? { validation_sticker_number: p.sticker_number } : {}),
  };

  let validationId: string;
  if (row) {
    const { data: updated, error } = await db.from("id_validations").update(validated).eq("id", row.id).eq("status", row.status).select("id");
    if (error) throw error;
    // Changed between the read and the write: send it again next time.
    if (((updated as unknown[] | null) ?? []).length === 0) throw new Error("validation changed meanwhile");
    validationId = row.id;
  } else {
    const { data: inserted, error } = await db
      .from("id_validations")
      .insert({ student_id: student.id, school_year: term.schoolYear, semester: term.semester, submitted_at: record.occurred_at, ...validated })
      .select("id")
      .single();
    if (error) throw error;
    validationId = (inserted as { id: string }).id;
  }

  const { error: notifyError } = await db.rpc("create_notification", {
    p_user_id: student.user_id,
    p_type: "id_validation_status",
    p_title: "Your ID is validated",
    p_body: `Your TUP ID is now valid for this term and will open the campus turnstiles. It was validated at the OSA counter on ${when}, while STARS was offline.`,
    p_priority: "normal",
    p_channels: ["in_app", "email"],
    p_action_url: "/id",
    p_action_label: "Open my Digital ID",
    p_entity_type: "id_validation",
    p_entity_id: validationId,
  });
  if (notifyError) console.error("[offline upload] notification not created", validationId, notifyError);

  await logSystemAuditEvent(p.validated_by_user_id, "id_validation_reviewed", "id_validations", {
    validation_id: validationId,
    decision: "validate_at_counter",
    student_number: student.student_number,
    via: "offline copy",
    validated_at: record.occurred_at,
  });

  return { outcome: "applied" as const, detail: `Validated at the counter on ${when}.`, studentId: student.id, review: false };
}
