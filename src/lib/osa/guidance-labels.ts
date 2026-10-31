/**
 * What guidance sessions are called on screen. The database keeps the
 * codes in guidance_sessions (migration 00012); staff see these words.
 */

export const SESSION_TYPES = [
  "walk_in",
  "scheduled",
  "referral",
  "risk_intervention",
  "disciplinary",
  "follow_up",
  "crisis",
] as const;

export const SESSION_TYPE_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  scheduled: "Scheduled appointment",
  referral: "Referral",
  risk_intervention: "From the at-risk list",
  disciplinary: "Discipline-related",
  follow_up: "Follow-up session",
  crisis: "Crisis",
};

export const SESSION_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Held",
  no_show: "Student did not come",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
};

/** guidance_sessions.concern_category accepts only these (00012's check). */
export const SESSION_CATEGORIES = [
  "academic",
  "financial",
  "family",
  "mental_health",
  "career",
  "peer_relations",
  "disciplinary",
  "health",
  "other",
] as const;

export const SESSION_CATEGORY_LABELS: Record<string, string> = {
  academic: "Academic",
  financial: "Financial",
  family: "Family",
  mental_health: "Mental health",
  career: "Career",
  peer_relations: "Friends and classmates",
  disciplinary: "Discipline",
  health: "Physical health",
  other: "Other",
};
