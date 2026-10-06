/**
 * POST /api/notifications/dispatch — drain the email outbox.
 *
 * Called once a minute by pg_cron from Supabase rather than by Vercel Cron,
 * which on the Hobby plan fires once a day. A summons delivered "sometime in
 * the next twenty-four hours" is not notice, and pg_cron reaches minute
 * granularity on every Supabase tier. The scheduling SQL is in migration
 * 00019, section 6.
 *
 * Authentication is a shared secret rather than a session: the caller is a
 * database job, not a person.
 */

import { timingSafeEqual } from "crypto";

import { after, NextResponse } from "next/server";

import { dispatchInvitations } from "@/lib/accounts/invitations";
import { summarizeConcerns } from "@/lib/concerns/summarize";
import { dispatchQueuedEmails } from "@/lib/notifications/dispatch";
import { sendHearingReminders } from "@/lib/osa/hearing-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

/**
 * Compares in constant time. A plain `===` on a secret leaks its prefix
 * through timing, and this endpoint is reachable from the open internet.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Refuse rather than run unauthenticated: an unset secret in production
  // would leave a mail-sending endpoint open to anyone who guessed the path.
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && secretMatches(token, expected);
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const started = Date.now();

  // Hearing reminders before the email pass, so the notices they queue go
  // out in this same run rather than a minute later.
  const reminders = await sendHearingReminders().catch((error: unknown) => {
    // Never let a reminder problem stop the summonses already queued.
    console.error("[reminders] run failed", error);
    return { sent: 0, held: "error" };
  });

  // Notices first, every tick: a summons must never wait behind a batch of
  // enrollment invitations for the same sending quota.
  const report = await dispatchQueuedEmails();
  const invitations = await dispatchInvitations();

  // Concern summaries the submit-time attempt missed or failed. Run after
  // the response, so a slow AI call can never hold pg_net past its 20-second
  // timeout and make the whole tick look failed.
  after(async () => {
    const concerns = await summarizeConcerns({ limit: 3 });
    if (concerns.claimed > 0 || concerns.held) {
      console.info(
        `[concerns] summaries: ${concerns.done} done, ${concerns.retrying} retrying, ${concerns.failed} failed` +
          (concerns.held ? ` (${concerns.held})` : ""),
      );
    }
  });

  // Logged on every run so cron.job_run_details is not the only record of
  // whether the queue is moving.
  console.info(
    `[notifications] dispatch via ${report.provider}: ${report.sent} sent, ` +
      `${report.skipped} skipped, ${report.failed} retrying, ` +
      `${report.undeliverable} gave up; invitations: ${invitations.sent} sent, ` +
      `${invitations.deferred} deferred${invitations.held ? ` (${invitations.held})` : ""}; ` +
      `reminders: ${reminders.sent} sent${reminders.held ? ` (${reminders.held})` : ""} ` +
      `(${Date.now() - started}ms)`,
  );

  return NextResponse.json(
    { ...report, invitations, reminders, ms: Date.now() - started },
    { headers: NO_STORE },
  );
}
