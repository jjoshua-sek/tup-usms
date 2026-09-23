/**
 * The reasoning behind the staff view of one student's record.
 *
 * Pure — rows in, conclusions out, no database and no clock — so the two
 * judgements the page makes can be tested rather than eyeballed:
 *
 *   describeService  was this student actually told about something?
 *   summarizeRecord  what, at a glance, needs an officer's attention?
 */

import {
  CASE_STATUS_META,
  CLEARANCE_STATUS_META,
  ID_STATUS_META,
  type CaseStatus,
  type ClearanceStatus,
  type IdValidationStatus,
} from "@/types/osa";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

// ============================================================
// PROOF OF SERVICE
// ============================================================

/** The delivery fields every notification row already carries. */
export interface NoticeDelivery {
  channels: string[] | null;
  is_read: boolean;
  read_at: string | null;
  email_status: string | null;
  email_sent_at: string | null;
  email_recipient: string | null;
}

export type EmailOutcome =
  | "sent"
  | "in_flight"
  | "failed"
  | "not_emailed";

export interface ServiceEvidence {
  tone: Tone;
  /** One line an officer can act on. */
  headline: string;
  email: EmailOutcome;
  emailedTo: string | null;
  emailedAt: string | null;
  openedAt: string | null;
}

/**
 * Collapses a notice's delivery fields into one answer to "was the student
 * told?"
 *
 * The question matters most right before the OSA proceeds without the
 * student — Rules on Discipline Sec. 7.7 allows a hearing ex parte after
 * non-appearance, and that is only fair if the summons actually reached
 * them. So the ordering is by strength of evidence, not by channel:
 *
 *   opened in the portal   the student saw it; nothing stronger exists
 *   accepted for email     it reached the address of record, unopened
 *   email still in flight  not yet evidence of anything
 *   email failed           actively known NOT to have arrived
 *   portal only, unopened  no evidence the student has seen it
 *
 * The page shows the facts behind the headline too; this decides only the
 * tone, because "Emailed" and "Opened" are different claims and an officer
 * should never have to infer which one they are looking at.
 */
export function describeService(notice: NoticeDelivery): ServiceEvidence {
  const email = emailOutcome(notice);
  const base = {
    email,
    emailedTo: email === "sent" ? notice.email_recipient : null,
    emailedAt: email === "sent" ? notice.email_sent_at : null,
    openedAt: notice.is_read ? notice.read_at : null,
  };

  if (notice.is_read) {
    return { ...base, tone: "success", headline: "Opened in the portal" };
  }
  if (email === "sent") {
    return { ...base, tone: "info", headline: "Emailed — not yet opened in the portal" };
  }
  if (email === "in_flight") {
    return { ...base, tone: "warning", headline: "Email still being delivered — not yet opened" };
  }
  if (email === "failed") {
    return {
      ...base,
      tone: "danger",
      headline: "Email could not be delivered and the notice is unopened — serve it by hand",
    };
  }
  return { ...base, tone: "warning", headline: "Portal only — not yet opened" };
}

function emailOutcome(notice: NoticeDelivery): EmailOutcome {
  switch (notice.email_status) {
    case "sent":
      return "sent";
    case "queued":
    case "sending":
    case "failed": // retryable — still on the backoff schedule
      return "in_flight";
    case "undeliverable":
    case "bounced":
      return "failed";
    default:
      // not_applicable, skipped (opted out, or no provider configured), null
      return "not_emailed";
  }
}

// ============================================================
// AT A GLANCE
// ============================================================

/** Community service statuses that still owe hours (matches check_student_clearance). */
const SERVICE_OPEN = new Set(["assigned", "in_progress", "not_served"]);

/** ID statuses that stop a student at the gate this term. */
const ID_BLOCKING = new Set<IdValidationStatus>(["rejected", "suspended", "revoked", "expired"]);

export interface GlanceInput {
  /** null when the viewer's role cannot see cases, so "0" is never implied. */
  cases: Array<{ status: CaseStatus }> | null;
  service: Array<{ status: string; hours_required: number; hours_completed: number | string }> | null;
  clearance: Array<{ status: ClearanceStatus; created_at: string }>;
  idValidations: Array<{ school_year: string; semester: string; status: IdValidationStatus }>;
  term: { schoolYear: string; semester: string };
}

export interface GlanceItem {
  key: "cases" | "service" | "id" | "clearance" | "risk";
  label: string;
  value: string;
  tone: Tone;
}

export function summarizeRecord(input: GlanceInput): GlanceItem[] {
  const items: GlanceItem[] = [];

  if (input.cases) {
    const open = input.cases.filter((row) => !CASE_STATUS_META[row.status]?.isTerminal).length;
    items.push({
      key: "cases",
      label: "Open cases",
      value: open === 0 ? "None" : String(open),
      tone: open === 0 ? "neutral" : "danger",
    });
  }

  if (input.service) {
    const owed = outstandingServiceHours(input.service);
    items.push({
      key: "service",
      label: "Service hours owed",
      value: owed === 0 ? "None" : formatHours(owed),
      tone: owed === 0 ? "neutral" : "warning",
    });
  }

  const current = input.idValidations.find(
    (row) => row.school_year === input.term.schoolYear && row.semester === input.term.semester,
  );
  items.push({
    key: "id",
    label: "ID this term",
    value: current ? ID_STATUS_META[current.status].label : "Not validated",
    tone: !current
      ? "warning"
      : current.status === "validated"
        ? "success"
        : ID_BLOCKING.has(current.status)
          ? "danger"
          : "info",
  });

  const latest = [...input.clearance].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  items.push({
    key: "clearance",
    label: "Latest clearance",
    value: latest ? CLEARANCE_STATUS_META[latest.status].label : "No requests",
    tone: !latest
      ? "neutral"
      : latest.status === "on_hold" || latest.status === "rejected"
        ? "danger"
        : ["cleared", "ready", "issued"].includes(latest.status)
          ? "success"
          : "info",
  });

  return items;
}

/**
 * Hours still owed across every open assignment. Over-served hours on one
 * assignment never offset another: each sanction is served on its own.
 */
export function outstandingServiceHours(
  rows: Array<{ status: string; hours_required: number; hours_completed: number | string }>,
): number {
  return rows
    .filter((row) => SERVICE_OPEN.has(row.status))
    .reduce((sum, row) => sum + Math.max(row.hours_required - Number(row.hours_completed), 0), 0);
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}
