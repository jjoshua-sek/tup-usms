/**
 * Retry schedule for failed email delivery.
 *
 * Pure, with the clock passed in, so the schedule can be asserted in a test
 * instead of waited out.
 *
 * The shape is deliberately front-loaded and then patient: a provider
 * hiccup resolves in seconds, so the first retry is quick; a suspended API
 * key or an exhausted quota takes a person to fix, so later retries spread
 * out rather than hammering. The last attempt lands roughly half a day after
 * the first, which for a hearing summons is still inside the notice period.
 */

/** Delay before the next attempt, indexed by the attempt that just failed. */
const SCHEDULE_MS: readonly number[] = [
  60_000, // 1st failed -> retry in 1 minute
  300_000, // 2nd        -> 5 minutes
  1_500_000, // 3rd      -> 25 minutes
  7_200_000, // 4th      -> 2 hours
  36_000_000, // 5th     -> 10 hours
];

/** After this many attempts a notification stops being retried. */
export const MAX_ATTEMPTS = SCHEDULE_MS.length + 1;

export type FailureOutcome =
  | { status: "failed"; nextAttemptAt: Date; attemptsRemaining: number }
  | { status: "undeliverable"; nextAttemptAt: null; attemptsRemaining: 0 };

/**
 * Works out what happens to a notification whose send just failed.
 *
 * `attempts` is the value already recorded on the row — `claim_email_batch`
 * increments it when it claims, so the first pass through here sees 1.
 */
export function nextAttempt(attempts: number, now: Date = new Date()): FailureOutcome {
  const delay = SCHEDULE_MS[attempts - 1];

  if (attempts >= MAX_ATTEMPTS || delay === undefined) {
    return { status: "undeliverable", nextAttemptAt: null, attemptsRemaining: 0 };
  }

  return {
    status: "failed",
    nextAttemptAt: new Date(now.getTime() + delay),
    attemptsRemaining: MAX_ATTEMPTS - attempts,
  };
}

/**
 * Some failures are worth retrying and some are not. Mailing a malformed
 * address five times produces five identical rejections, so a permanent
 * refusal from the provider goes straight to undeliverable — that surfaces
 * the problem to staff in minutes rather than half a day.
 */
export function isPermanentFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /invalid (recipient|address)|no such user|mailbox unavailable|blocked|5\.1\.[13]/i.test(
    message,
  );
}
