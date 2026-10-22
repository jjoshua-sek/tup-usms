import { manilaWallClock } from "@/lib/utils/time";

import { appealWindow, resolveAppealRoute, type PenaltyBasis } from "./sanctions";

/**
 * A student filing an appeal with the OSA (checklist B5). The OSA receives
 * it and forwards it to the body Sec. 9 names for the sanction; it does not
 * decide it. Pure, so the window and the wording can be tested; the actions
 * are fileAppeal (student) and forwardAppeal (staff).
 */

/** Long enough to say why; the appellate body needs reasons, not a sentence. */
export const MIN_APPEAL_GROUNDS = 50;
export const MAX_APPEAL_GROUNDS = 5000;

export type FilingCheck = { ok: true } | { ok: false; reason: string };

/** Whether this appeal can be filed now: its window is open and nothing is filed yet. */
export function canFileAppeal(input: {
  status: string;
  penaltyBasis: string;
  noticeReceivedOn: string;
  now?: Date;
}): FilingCheck {
  if (input.status !== "window_open") {
    return { ok: false, reason: input.status === "filed" ? "This appeal has already been filed." : "This appeal can no longer be filed." };
  }
  const route = resolveAppealRoute(input.penaltyBasis as PenaltyBasis);
  const window = appealWindow(input.noticeReceivedOn, route?.days ?? 10, input.now);
  if (!window.isOpen) return { ok: false, reason: "The appeal period has ended, so the decision stands." };
  return { ok: true };
}

/** The grounds, trimmed and checked; an error message when they will not do. */
export function checkGrounds(grounds: string): { ok: true; text: string } | { ok: false; reason: string } {
  const text = grounds.trim();
  if (text.length < MIN_APPEAL_GROUNDS) {
    return { ok: false, reason: `Explain why the decision should be changed, in at least ${MIN_APPEAL_GROUNDS} characters.` };
  }
  if (text.length > MAX_APPEAL_GROUNDS) return { ok: false, reason: `Keep the appeal under ${MAX_APPEAL_GROUNDS} characters.` };
  return { ok: true, text };
}

/** Today on the Manila calendar, as YYYY-MM-DD: the date an appeal is filed on. */
export function manilaToday(now: Date = new Date()): string {
  const { year, month, day } = manilaWallClock(now);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
