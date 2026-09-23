/**
 * Who gets an email, and who does not.
 *
 * Pure policy — no I/O, no database, no clock. The dispatcher asks this
 * module one question per notification and does what it says, which keeps
 * the rule that matters ("a student cannot mute a summons") in a file that
 * can be read and tested on its own.
 *
 * The obligation principle: a notification bypasses preferences when
 * ignoring it would cost the student something — a hearing they must
 * attend, a deadline that starts running, a graduation that stops moving.
 * Everything else is ordinary mail a person is entitled to switch off.
 *
 * Kept in step with the table comment on notification_preferences
 * (migration 00019, section 7).
 */

/** Every notification_type permitted by the CHECK constraint in 00012. */
export type NotificationType =
  // Disciplinary
  | "case_filed"
  | "hearing_scheduled"
  | "hearing_reminder"
  | "hearing_rescheduled"
  | "apology_required"
  | "apology_reviewed"
  | "settlement_ready"
  | "case_resolved"
  | "sanction_applied"
  | "case_escalated"
  | "appeal_window_opened"
  // Scheduling
  | "schedule_proposed"
  | "schedule_approval_needed"
  // Scholarships
  | "scholarship_match"
  | "scholarship_deadline"
  | "scholarship_status"
  | "masterlist_listed"
  // Clearance
  | "clearance_update"
  | "clearance_on_hold"
  | "clearance_ready"
  // ID validation
  | "id_validation_status"
  | "id_expiring"
  // Guidance & risk
  | "guidance_scheduled"
  | "guidance_reminder"
  | "intervention_assigned"
  | "risk_alert"
  // Academic documents
  | "document_verified"
  | "document_rejected"
  | "document_needed"
  // General
  | "announcement"
  | "general";

export interface NotificationPreferences {
  email_enabled: boolean;
  scholarship_alerts: boolean;
  guidance_reminders: boolean;
  announcements: boolean;
}

/** Preferences applied to a user who has never opened the settings page. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_enabled: true,
  scholarship_alerts: true,
  guidance_reminders: true,
  announcements: true,
};

/**
 * Notices that create an obligation or start a clock. These are delivered on
 * every available channel regardless of preferences.
 *
 * `case_resolved` is on the list for a reason that is easy to miss: Rules on
 * Discipline Sec. 9 runs the ten-day appeal window from receipt of the
 * decision, so muting the decision mutes the only warning a student gets
 * that their window has opened.
 */
export const ALWAYS_DELIVER: ReadonlySet<NotificationType> = new Set([
  "case_filed",
  "hearing_scheduled",
  "hearing_rescheduled",
  "hearing_reminder",
  "apology_required",
  "sanction_applied",
  "settlement_ready",
  "case_resolved",
  "case_escalated",
  "appeal_window_opened",
  "clearance_on_hold",
]);

/** Which preference toggle governs an optional notification type. */
const GOVERNED_BY: Partial<Record<NotificationType, keyof NotificationPreferences>> = {
  scholarship_match: "scholarship_alerts",
  scholarship_deadline: "scholarship_alerts",
  scholarship_status: "scholarship_alerts",
  masterlist_listed: "scholarship_alerts",

  guidance_scheduled: "guidance_reminders",
  guidance_reminder: "guidance_reminders",
  intervention_assigned: "guidance_reminders",

  announcement: "announcements",
  general: "announcements",
};

export type SkipReason =
  | "no_recipient_address"
  | "email_disabled"
  | "category_muted"
  | "not_allowlisted";

export interface DeliveryDecision {
  send: boolean;
  /** Present only when `send` is false; stored on the row for the audit trail. */
  reason?: SkipReason;
  /** True when preferences were overridden because the notice is mandatory. */
  mandatory: boolean;
}

export interface DeliveryInput {
  type: NotificationType | string;
  recipient: string | null | undefined;
  preferences: NotificationPreferences;
  /**
   * Non-production safety net. When present, only these addresses may be
   * mailed; everything else is skipped. Prevents a seeded or restored
   * database from mailing real students about fabricated cases.
   */
  allowlist?: readonly string[] | null;
}

const send = (mandatory: boolean): DeliveryDecision => ({ send: true, mandatory });
const skip = (reason: SkipReason, mandatory: boolean): DeliveryDecision => ({
  send: false,
  reason,
  mandatory,
});

/**
 * Decides whether one notification may be emailed.
 *
 * Order matters. The allowlist is checked before the mandatory override,
 * because "this is a summons" is a reason to ignore a student's preferences
 * — never a reason to ignore the developer's guard against mailing real
 * people from a test database.
 */
export function decideDelivery(input: DeliveryInput): DeliveryDecision {
  const mandatory = ALWAYS_DELIVER.has(input.type as NotificationType);
  const recipient = input.recipient?.trim().toLowerCase();

  if (!recipient) return skip("no_recipient_address", mandatory);

  if (input.allowlist && !input.allowlist.includes(recipient)) {
    return skip("not_allowlisted", mandatory);
  }

  if (mandatory) return send(true);

  if (!input.preferences.email_enabled) return skip("email_disabled", false);

  const toggle = GOVERNED_BY[input.type as NotificationType];
  if (toggle && !input.preferences[toggle]) return skip("category_muted", false);

  return send(false);
}

/** Human-readable text stored in `email_skip_reason`. */
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  no_recipient_address: "the account has no email address on record",
  email_disabled: "the student turned off email notifications",
  category_muted: "the student muted this category of notification",
  not_allowlisted: "blocked by EMAIL_ALLOWLIST outside production",
};
