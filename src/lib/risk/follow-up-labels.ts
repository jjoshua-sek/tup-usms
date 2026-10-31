/**
 * What follow-ups (risk_interventions) are called on screen.
 *
 * The database keeps short codes (guidance_referral, in_progress); staff see
 * these words instead. A type typed in by hand, which has no entry here,
 * is shown with its underscores turned into spaces.
 */

export const FOLLOW_UP_TYPE_LABELS: Record<string, string> = {
  guidance_referral: "Guidance referral",
  academic_advising: "Academic advising",
  academic_coaching: "Academic coaching",
  tutoring_referral: "Tutoring referral",
  wellness_check: "Wellness check",
  financial_aid_referral: "Financial aid referral",
  disciplinary_followup: "Discipline follow-up",
  attendance_check_in: "Attendance check-in",
};

export const FOLLOW_UP_STATUS_LABELS: Record<string, string> = {
  recommended: "Not started",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Done",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const FOLLOW_UP_OUTCOME_LABELS: Record<string, string> = {
  improved: "Improved",
  no_change: "No change",
  worsened: "Worsened",
  inconclusive: "Too early to tell",
};

/** Statuses after which a follow-up is finished. */
export const FOLLOW_UP_FINISHED = ["completed", "declined", "cancelled"] as const;

function words(code: string): string {
  const spaced = code.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function followUpTypeLabel(type: string): string {
  return FOLLOW_UP_TYPE_LABELS[type] ?? words(type);
}

export function followUpStatusLabel(status: string): string {
  return FOLLOW_UP_STATUS_LABELS[status] ?? words(status);
}
