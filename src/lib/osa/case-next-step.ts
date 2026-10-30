/**
 * The one sentence at the top of a case page: what the OSA does next.
 *
 * A case page holds every step of the process (scheduling, letters,
 * settlement, referral, appeal), and most are not relevant at once. This
 * picks the one that is, from the case's state, and names the section of
 * the page where it is done. Pure, so the wording is tested without a
 * database.
 */

import { CASE_STATUS_META, type CaseStatus } from "@/types/osa";

/** Sections of the case page a next step can point to (their element ids). */
export type CaseSection = "classify" | "schedule" | "apology" | "settlement" | "referrals" | "appeal" | "update";

export interface CaseState {
  status: CaseStatus;
  classificationPending: boolean;
  /** An apology letter is waiting for the OSA to read it. */
  letterToRead: boolean;
  /** A meeting date waits for the complainant's approval. */
  dateAwaitingApproval: boolean;
  /** A meeting date is approved and the student has not been notified. */
  dateToNotify: boolean;
  /** The scheduler has suggested times nobody has picked yet. */
  hasSuggestedTimes: boolean;
  /** An appeal record exists. */
  hasAppeal: boolean;
}

export interface NextStep {
  text: string;
  /** Where on the page it is done; null when nothing is left to do. */
  section: CaseSection | null;
}

export function caseNextStep(state: CaseState): NextStep {
  if (CASE_STATUS_META[state.status]?.isTerminal) {
    return { text: "This case is closed. Nothing more needs doing.", section: null };
  }
  if (state.classificationPending) {
    return {
      text: "Classify this case as minor or major. Scheduling waits until it is classified.",
      section: "classify",
    };
  }
  if (state.letterToRead) {
    return { text: "Read the student's apology letter, then accept it or ask for changes.", section: "apology" };
  }
  if (state.dateToNotify) {
    return { text: "The meeting date is approved. Notify the student so they are summoned.", section: "schedule" };
  }
  if (state.dateAwaitingApproval) {
    return { text: "Waiting for the complainant to approve the meeting date.", section: "schedule" };
  }

  switch (state.status) {
    case "filed":
    case "under_review":
      return state.hasSuggestedTimes
        ? { text: "Pick one of the suggested meeting times.", section: "schedule" }
        : { text: "Find a meeting time when the student and the complainant are both free.", section: "schedule" };
    case "counselling_scheduled":
    case "hearing_scheduled":
    case "summons_sent":
      return { text: "Hold the meeting on the scheduled date, then update the case with what happened.", section: "update" };
    case "awaiting_apology":
      return { text: "Waiting for the student's apology letter.", section: "apology" };
    case "hearing_completed":
      return {
        text: "Record the outcome: update the case, draft a settlement, or refer it to a committee.",
        section: "update",
      };
    case "in_mediation":
      return { text: "Draft the settlement once both sides agree on the terms.", section: "settlement" };
    case "settled":
      return { text: "Check that the student meets the settlement terms, then close the case.", section: "settlement" };
    case "escalated_pic":
    case "escalated_sdb":
    case "referred_codi":
      return { text: "Waiting for the committee's decision. Record it when it comes back.", section: "referrals" };
    case "sanctioned":
      return state.hasAppeal
        ? { text: "Follow the appeal, then close the case once it is decided.", section: "appeal" }
        : {
            text: "Record when the student received the Notice of Decision. That starts the 10-day appeal period.",
            section: "appeal",
          };
    default:
      return { text: "Update the case when something changes.", section: "update" };
  }
}
