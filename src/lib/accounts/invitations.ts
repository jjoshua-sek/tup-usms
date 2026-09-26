/**
 * Sends account invitations: one-time sign-in links for accounts created
 * from an enrollment list.
 *
 * Runs on the same once-a-minute pg_cron call as the notification
 * dispatcher (/api/notifications/dispatch), after it, so there is no second
 * job to schedule.
 *
 * Three rules shape it:
 *
 *   1. The link is minted here, at the moment of sending, and never stored.
 *      account_invitations records that one is owed; the token exists only
 *      in the email. Each new link replaces the previous one, so a resend
 *      invalidates whatever was sent before.
 *
 *   2. Enrollment mail must never starve disciplinary notices. Both go out
 *      through the same Gmail account and its ~500-a-day limit, so
 *      invitations are capped per day (INVITATIONS_PER_DAY, default 300)
 *      and run after notifications on every tick. A 1,000-student import
 *      takes a few days to finish; a summons still goes out the same minute.
 *
 *   3. Hitting the provider's quota stops the run. Every further send would
 *      be refused the same way, so the rest of the batch goes back in the
 *      queue for an hour without spending its retries.
 */

import { isPermanentFailure, isQuotaFailure, nextAttempt } from "@/lib/notifications/backoff";
import {
  PermanentDeliveryError,
  resolveAllowlist,
  resolveProvider,
  type EmailProvider,
} from "@/lib/notifications/providers";
import { renderNotificationEmail } from "@/lib/notifications/template";
import { loose } from "@/lib/supabase/loose";

interface ClaimedInvitation {
  id: string;
  user_id: string;
  student_number: string;
  first_name: string;
  delivery_email: string;
  login_email: string;
  attempts: number;
}

export interface InvitationReport {
  claimed: number;
  sent: number;
  failed: number;
  undeliverable: number;
  /** Put back in the queue after the provider's quota was reached. */
  deferred: number;
  /** Why nothing was attempted this run, when that was the case. */
  held?: string;
}

const DEFAULT_DAILY_CAP = 300;
const QUOTA_PAUSE_MS = 60 * 60 * 1000;

function dailyCap(): number {
  const configured = Number.parseInt(process.env.INVITATIONS_PER_DAY ?? "", 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_DAILY_CAP;
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

export function invitationEmail(input: {
  firstName: string;
  studentNumber: string;
  confirmPath: string;
  appUrl: string;
}) {
  const origin = input.appUrl.replace(/\/+$/, "");
  return renderNotificationEmail({
    title: "Set up your TUP-Manila student account",
    body:
      `Hi ${input.firstName},\n\n` +
      `The Office of Student Affairs has created your TUP-Manila USMS account.\n\n` +
      `Student number: ${input.studentNumber}\n\n` +
      `Use the button below to choose your password. The link works once and expires after a short time — ` +
      `if it has expired, ask the OSA to send you a new one.\n\n` +
      `After that, sign in at ${origin}/login with your student number and the password you chose.`,
    actionUrl: input.confirmPath,
    actionLabel: "Set up my account",
    priority: "normal",
    appUrl: input.appUrl,
    sentTo: "personal",
  });
}

export async function dispatchInvitations(
  options: { provider?: EmailProvider; limit?: number; now?: Date } = {},
): Promise<InvitationReport> {
  const report: InvitationReport = { claimed: 0, sent: 0, failed: 0, undeliverable: 0, deferred: 0 };
  const provider = options.provider ?? resolveProvider();
  const now = options.now ?? new Date();

  // A sign-in link written to a log is a working credential in a log. In
  // production, with no provider that can deliver, leave the queue alone
  // until one is configured. On a developer machine the console provider
  // printing the link is exactly how the flow gets tested.
  if (!provider.deliversExternally && isProduction()) {
    report.held = "no mail provider is configured; invitations stay queued";
    return report;
  }

  const allowlist = provider.deliversExternally ? resolveAllowlist() : null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const db = loose(admin);

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count: sentToday } = await db
    .from("account_invitations")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", since);

  const remaining = dailyCap() - (sentToday ?? 0);
  if (remaining <= 0) {
    report.held = "daily invitation limit reached; the rest go out tomorrow";
    return report;
  }

  const { data, error } = await db.rpc("claim_invitation_batch", {
    p_limit: Math.min(options.limit ?? 10, remaining),
  });
  if (error) {
    console.error("[invitations] claim failed", error);
    report.held = "could not claim a batch";
    return report;
  }

  const rows = (data as ClaimedInvitation[] | null) ?? [];
  report.claimed = rows.length;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (allowlist && !allowlist.includes(row.delivery_email.trim().toLowerCase())) {
      report.undeliverable += 1;
      await db
        .from("account_invitations")
        .update({
          status: "undeliverable",
          last_error: "blocked by EMAIL_ALLOWLIST outside production",
          next_attempt_at: null,
        })
        .eq("id", row.id);
      continue;
    }

    try {
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: row.login_email,
      });
      if (linkError || !link?.properties?.hashed_token) {
        throw new Error(`could not generate a sign-in link: ${linkError?.message ?? "no token returned"}`);
      }

      const confirmPath =
        `/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}` +
        `&type=${encodeURIComponent(link.properties.verification_type)}`;

      const message = invitationEmail({
        firstName: row.first_name,
        studentNumber: row.student_number,
        confirmPath,
        appUrl,
      });

      const sent = await provider.send({
        to: row.delivery_email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      report.sent += 1;
      await db
        .from("account_invitations")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_id: `${provider.name}:${sent.id}`,
          last_error: null,
          next_attempt_at: null,
        })
        .eq("id", row.id);
    } catch (sendError) {
      const detail = sendError instanceof Error ? sendError.message : String(sendError ?? "unknown");

      if (isQuotaFailure(sendError)) {
        // This row and every one after it go back untouched: same queue
        // position, retries refunded, tried again in an hour.
        const pending = rows.slice(index);
        report.deferred += pending.length;
        const retryAt = new Date(now.getTime() + QUOTA_PAUSE_MS).toISOString();
        for (const deferred of pending) {
          await db
            .from("account_invitations")
            .update({
              status: "queued",
              attempts: Math.max(deferred.attempts - 1, 0),
              next_attempt_at: retryAt,
              last_error: `sending quota reached: ${detail}`.slice(0, 500),
            })
            .eq("id", deferred.id);
        }
        break;
      }

      const permanent = sendError instanceof PermanentDeliveryError || isPermanentFailure(sendError);
      const outcome = permanent
        ? ({ status: "undeliverable", nextAttemptAt: null } as const)
        : nextAttempt(row.attempts, now);

      if (outcome.status === "undeliverable") report.undeliverable += 1;
      else report.failed += 1;

      await db
        .from("account_invitations")
        .update({
          status: outcome.status,
          last_error: detail.slice(0, 500),
          next_attempt_at: outcome.nextAttemptAt?.toISOString() ?? null,
        })
        .eq("id", row.id);
    }
  }

  return report;
}
