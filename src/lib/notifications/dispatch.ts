/**
 * Drains the notification outbox.
 *
 * `create_notification` (migration 00012) writes a row inside the same
 * transaction as the staff action that raised it — so a summons can never be
 * emailed for a hearing that failed to save, and can never be lost because
 * the mail provider happened to be down. This is the other half of that
 * arrangement: the pump that moves queued rows out to a provider and records
 * what happened to each one.
 *
 * Everything decision-shaped lives in the pure modules beside this file
 * (policy, backoff, template) so it can be tested. What is left here is the
 * I/O: claim, send, record.
 */

import { loose } from "@/lib/supabase/loose";

import { isPermanentFailure, nextAttempt } from "./backoff";
import { decideDelivery, SKIP_REASON_TEXT, type NotificationPreferences } from "./policy";
import {
  PermanentDeliveryError,
  resolveAllowlist,
  resolveProvider,
  type EmailProvider,
} from "./providers";
import { renderNotificationEmail } from "./template";

/** One row as `claim_email_batch` returns it. */
interface ClaimedRow {
  id: string;
  user_id: string;
  notification_type: string;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  priority: string | null;
  recipient: string | null;
  attempts: number;
  created_at: string;
  email_enabled: boolean;
  scholarship_alerts: boolean;
  guidance_reminders: boolean;
  announcements: boolean;
}

export interface DispatchReport {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  undeliverable: number;
  provider: string;
  /** Present when the run ended early; the batch is left for the reaper. */
  error?: string;
}

export interface DispatchOptions {
  /** Rows per run. Kept well inside the function timeout at ~1s per send. */
  limit?: number;
  provider?: EmailProvider;
  allowlist?: readonly string[] | null;
  appUrl?: string;
  now?: Date;
}

export async function dispatchQueuedEmails(
  options: DispatchOptions = {},
): Promise<DispatchReport> {
  const provider = options.provider ?? resolveProvider();
  // A provider that writes to the log cannot reach a student, so the
  // non-production allowlist has nothing to protect and is not applied.
  // Without this, the safe default configuration (console provider, no
  // allowlist set) skips every message and reads as a broken queue.
  const allowlist =
    options.allowlist !== undefined
      ? options.allowlist
      : provider.deliversExternally
        ? resolveAllowlist()
        : null;
  const appUrl =
    options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;

  const report: DispatchReport = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    undeliverable: 0,
    provider: provider.name,
  };

  // Deferred import keeps the admin client out of any module graph that a
  // test of the pure helpers might pull in.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = loose(createAdminClient());

  const { data, error } = await db.rpc("claim_email_batch", { p_limit: limit });

  if (error) {
    report.error = "could not claim a batch";
    console.error("[notifications] claim failed", error);
    return report;
  }

  const rows = (data as ClaimedRow[] | null) ?? [];
  report.claimed = rows.length;

  for (const row of rows) {
    const preferences: NotificationPreferences = {
      email_enabled: row.email_enabled,
      scholarship_alerts: row.scholarship_alerts,
      guidance_reminders: row.guidance_reminders,
      announcements: row.announcements,
    };

    const decision = decideDelivery({
      type: row.notification_type,
      recipient: row.recipient,
      preferences,
      allowlist,
    });

    if (!decision.send) {
      report.skipped += 1;
      await db
        .from("notifications")
        .update({
          email_status: "skipped",
          email_skip_reason: SKIP_REASON_TEXT[decision.reason!],
          email_recipient: row.recipient ?? null,
          email_next_attempt_at: null,
        })
        .eq("id", row.id);
      continue;
    }

    const message = renderNotificationEmail({
      title: row.title,
      body: row.body,
      actionUrl: row.action_url,
      actionLabel: row.action_label,
      priority: row.priority,
      appUrl,
    });

    try {
      const sent = await provider.send({
        to: row.recipient!,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      report.sent += 1;
      await db
        .from("notifications")
        .update({
          email_status: "sent",
          email_sent_at: new Date().toISOString(),
          email_recipient: row.recipient,
          email_provider_id: `${provider.name}:${sent.id}`,
          email_error: null,
          email_next_attempt_at: null,
        })
        .eq("id", row.id);
    } catch (sendError) {
      const permanent =
        sendError instanceof PermanentDeliveryError || isPermanentFailure(sendError);
      const outcome = permanent
        ? ({ status: "undeliverable", nextAttemptAt: null } as const)
        : nextAttempt(row.attempts, now);

      const detail =
        sendError instanceof Error ? sendError.message : String(sendError ?? "unknown");

      if (outcome.status === "undeliverable") report.undeliverable += 1;
      else report.failed += 1;

      await db
        .from("notifications")
        .update({
          email_status: outcome.status,
          email_error: detail.slice(0, 500),
          email_recipient: row.recipient,
          email_next_attempt_at: outcome.nextAttemptAt?.toISOString() ?? null,
        })
        .eq("id", row.id);

      // An undeliverable disciplinary notice is not a logging matter: nobody
      // has been served, and a person has to do something about it.
      if (outcome.status === "undeliverable") {
        console.error(
          `[notifications] gave up on ${row.notification_type} for user ${row.user_id}: ${detail}`,
        );
      }
    }
  }

  return report;
}
