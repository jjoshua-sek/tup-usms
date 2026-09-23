import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, isPermanentFailure, nextAttempt } from "./backoff";

const NOW = new Date("2026-09-23T08:00:00.000Z");
const minutesAfter = (minutes: number) =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe("nextAttempt", () => {
  it("retries a minute after the first failure", () => {
    const outcome = nextAttempt(1, NOW);

    expect(outcome.status).toBe("failed");
    expect(outcome.nextAttemptAt?.toISOString()).toBe(minutesAfter(1));
  });

  it("spreads later retries out", () => {
    expect(nextAttempt(2, NOW).nextAttemptAt?.toISOString()).toBe(minutesAfter(5));
    expect(nextAttempt(3, NOW).nextAttemptAt?.toISOString()).toBe(minutesAfter(25));
    expect(nextAttempt(4, NOW).nextAttemptAt?.toISOString()).toBe(minutesAfter(120));
    expect(nextAttempt(5, NOW).nextAttemptAt?.toISOString()).toBe(minutesAfter(600));
  });

  it("gives up once the schedule is exhausted", () => {
    const outcome = nextAttempt(MAX_ATTEMPTS, NOW);

    expect(outcome.status).toBe("undeliverable");
    expect(outcome.nextAttemptAt).toBeNull();
  });

  it("stays given up for attempt counts beyond the maximum", () => {
    // A reaped row can re-enter with a higher count than the schedule covers.
    expect(nextAttempt(MAX_ATTEMPTS + 5, NOW).status).toBe("undeliverable");
  });

  it("finishes the whole schedule inside a day", () => {
    // A hearing summons that exhausts every retry should still have done so
    // while there is time to serve the student another way.
    const total = [1, 2, 3, 4, 5].reduce((sum, attempt) => {
      const outcome = nextAttempt(attempt, NOW);
      return sum + (outcome.nextAttemptAt!.getTime() - NOW.getTime());
    }, 0);

    expect(total).toBeLessThan(24 * 60 * 60_000);
  });
});

describe("isPermanentFailure", () => {
  it("recognises a rejected recipient", () => {
    expect(isPermanentFailure(new Error("550 5.1.1 invalid recipient"))).toBe(true);
    expect(isPermanentFailure(new Error("No such user here"))).toBe(true);
  });

  it("treats transient trouble as retryable", () => {
    expect(isPermanentFailure(new Error("ETIMEDOUT"))).toBe(false);
    expect(isPermanentFailure(new Error("451 try again later"))).toBe(false);
    expect(isPermanentFailure(undefined)).toBe(false);
  });
});
