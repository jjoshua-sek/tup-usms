-- ============================================================
-- 00019: NOTIFICATION EMAIL DELIVERY
-- ============================================================
-- Migration 00012 built the outbox: `create_notification` writes a row with
-- `email_status = 'queued'` and every disciplinary action calls it. Nothing
-- ever drained that queue, so "also sent to your institutional address" has
-- been untrue since the feature shipped.
--
-- This migration adds the state a real dispatcher needs — attempt counting,
-- backoff, a provider message id for the audit trail — and the claiming
-- function that lets a worker take a batch without two overlapping runs
-- mailing the same summons twice.
--
-- The worker itself lives in the Next.js app (`/api/notifications/dispatch`)
-- rather than an Edge Function, so it can share the app's pure policy modules
-- and be unit-tested. Postgres only schedules it; see section 6.
-- ============================================================

-- ------------------------------------------------------------
-- 1. DELIVERY STATE COLUMNS
-- ------------------------------------------------------------
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS email_attempts        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS email_skip_reason     TEXT;

COMMENT ON COLUMN public.notifications.email_attempts IS
  'Delivery attempts made. Drives the backoff schedule and the give-up threshold.';
COMMENT ON COLUMN public.notifications.email_next_attempt_at IS
  'Earliest time a failed send may be retried. NULL means "eligible now".';
COMMENT ON COLUMN public.notifications.email_provider_id IS
  'The mail provider''s message id. This is the audit trail when a student says a summons never arrived.';
COMMENT ON COLUMN public.notifications.email_skip_reason IS
  'Why a notification was never emailed — an opt-out, a missing address, or a non-production allowlist block.';

-- ------------------------------------------------------------
-- 1b. MISSING NOTIFICATION TYPES
-- ------------------------------------------------------------
-- Building the dispatcher surfaced a defect that had been silent since
-- 00012: thirteen of the fourteen `create_notification` call sites pass a
-- notification_type the CHECK constraint rejects. Every one of those calls
-- is `await db.rpc(...)` with the result discarded, and supabase-js returns
-- errors rather than throwing — so the insert failed, the server action
-- reported success, and the student was told nothing on any channel. The
-- summons was the worst of them.
--
-- The call sites are corrected to use the existing vocabulary wherever one
-- fits. Two concepts genuinely postdate 00012 and are added here:
--   * case_escalated      — referral to the SDT (00007 escalations)
--   * appeal_window_opened — the Sec. 9 ten-day clock (00018 case_appeals)
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_notification_type_check CHECK (
    notification_type IN (
      -- Disciplinary
      'case_filed', 'hearing_scheduled', 'hearing_reminder',
      'hearing_rescheduled', 'apology_required', 'apology_reviewed',
      'settlement_ready', 'case_resolved', 'sanction_applied',
      'case_escalated', 'appeal_window_opened',
      -- Scheduling
      'schedule_proposed', 'schedule_approval_needed',
      -- Scholarships
      'scholarship_match', 'scholarship_deadline', 'scholarship_status',
      'masterlist_listed',
      -- Clearance
      'clearance_update', 'clearance_on_hold', 'clearance_ready',
      -- ID validation
      'id_validation_status', 'id_expiring',
      -- Guidance & risk
      'guidance_scheduled', 'guidance_reminder', 'intervention_assigned',
      'risk_alert',
      -- Academic documents
      'document_verified', 'document_rejected', 'document_needed',
      -- General
      'announcement', 'general'
    )
  );

-- ------------------------------------------------------------
-- 2. WIDEN THE STATUS MACHINE
-- ------------------------------------------------------------
-- queued        -> waiting for a worker
-- sending       -> claimed by a worker, in flight (prevents double-send)
-- sent          -> the provider accepted it
-- failed        -> retryable; email_next_attempt_at says when
-- undeliverable -> gave up after the last attempt; staff must serve by hand
-- skipped       -> deliberately not sent (opt-out, no address, allowlist)
-- bounced       -> reserved for a future provider webhook
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_email_status_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_email_status_check CHECK (
    email_status IN (
      'not_applicable', 'queued', 'sending', 'sent',
      'failed', 'undeliverable', 'skipped', 'bounced'
    ) OR email_status IS NULL
  );

-- The dispatch queue index from 00012 covers ('queued','failed'), which stay
-- the two retryable states. This one keeps the backoff filter sargable.
CREATE INDEX IF NOT EXISTS idx_notif_email_retry
  ON public.notifications(email_next_attempt_at)
  WHERE email_status = 'failed';

-- Finding rows abandoned by a crashed worker.
CREATE INDEX IF NOT EXISTS idx_notif_email_sending
  ON public.notifications(created_at)
  WHERE email_status = 'sending';

-- ------------------------------------------------------------
-- 3. BACKLOG GUARD
-- ------------------------------------------------------------
-- Every notification created since 00012 is sitting at 'queued'. Without this
-- the first worker run would mail months of accumulated notices at once —
-- students receiving summonses for cases that closed long ago. Anything
-- already queued when this migration runs is retired, not delivered.
UPDATE public.notifications
SET email_status    = 'skipped',
    email_skip_reason = 'backlog retired when the dispatcher was introduced (migration 00019)'
WHERE email_status = 'queued';

-- ------------------------------------------------------------
-- 4. CLAIMING A BATCH
-- ------------------------------------------------------------
-- The correctness centre of the whole feature.
--
-- FOR UPDATE SKIP LOCKED lets a second worker step over rows the first has
-- already taken instead of blocking on them, and the move to 'sending'
-- happens in the same statement that selects. Two overlapping cron runs
-- therefore claim disjoint sets, and a summons cannot be mailed twice.
--
-- The recipient is auth.users.email, which for this deployment IS the
-- institutional address: login derives it as
-- <student_number>@tup.edu.ph (see components/auth/login-form.tsx). The
-- personal address on students.email_address is deliberately not used — a
-- disciplinary notice goes to the address of record, not a private inbox.
CREATE OR REPLACE FUNCTION public.claim_email_batch(
  p_limit        INT DEFAULT 25,
  p_max_age_days INT DEFAULT 7
)
RETURNS TABLE (
  id                  UUID,
  user_id             UUID,
  notification_type   TEXT,
  title               TEXT,
  body                TEXT,
  action_url          TEXT,
  action_label        TEXT,
  priority            TEXT,
  recipient           TEXT,
  attempts            INT,
  created_at          TIMESTAMPTZ,
  email_enabled       BOOLEAN,
  scholarship_alerts  BOOLEAN,
  guidance_reminders  BOOLEAN,
  announcements       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.notifications n
    SET email_status  = 'sending',
        email_attempts = n.email_attempts + 1
    WHERE n.id IN (
      SELECT c.id
      FROM public.notifications c
      WHERE c.email_status IN ('queued', 'failed')
        -- A notice nobody could deliver for a week is stale; sending it now
        -- confuses more than it informs.
        AND c.created_at > NOW() - MAKE_INTERVAL(days => p_max_age_days)
        AND (c.email_next_attempt_at IS NULL OR c.email_next_attempt_at <= NOW())
      ORDER BY
        CASE c.priority
          WHEN 'urgent' THEN 0
          WHEN 'high'   THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING n.id, n.user_id, n.notification_type, n.title, n.body,
              n.action_url, n.action_label, n.priority, n.email_attempts,
              n.created_at
  )
  SELECT
    c.id,
    c.user_id,
    c.notification_type,
    c.title,
    c.body,
    c.action_url,
    c.action_label,
    c.priority,
    u.email::TEXT,
    c.email_attempts,
    c.created_at,
    COALESCE(p.email_enabled, TRUE),
    COALESCE(p.scholarship_alerts, TRUE),
    COALESCE(p.guidance_reminders, TRUE),
    COALESCE(p.announcements, TRUE)
  FROM claimed c
  LEFT JOIN auth.users u ON u.id = c.user_id
  LEFT JOIN public.notification_preferences p ON p.user_id = c.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_email_batch(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_email_batch(INT, INT) FROM authenticated;

COMMENT ON FUNCTION public.claim_email_batch(INT, INT) IS
  'Atomically claims a batch of queued notifications for email delivery. Service role only — never grant to authenticated, since the return value carries other users'' email addresses.';

-- ------------------------------------------------------------
-- 5. REAPING ABANDONED SENDS
-- ------------------------------------------------------------
-- A worker that crashes between claiming and recording leaves rows stuck at
-- 'sending' forever. Returning them to 'failed' puts them back in the queue
-- on the normal backoff path.
CREATE OR REPLACE FUNCTION public.reap_stuck_email_sends(p_minutes INT DEFAULT 10)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reaped INT;
BEGIN
  UPDATE public.notifications
  SET email_status = 'failed',
      email_error  = COALESCE(email_error, 'worker did not report an outcome; requeued'),
      email_next_attempt_at = NOW()
  WHERE email_status = 'sending'
    AND created_at < NOW() - MAKE_INTERVAL(mins => p_minutes);

  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_email_sends(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reap_stuck_email_sends(INT) FROM authenticated;

-- ------------------------------------------------------------
-- 6. SCHEDULING
-- ------------------------------------------------------------
-- Vercel's Hobby plan runs cron once per day, which is not notice for a
-- summons. pg_cron has minute granularity on every Supabase tier and pg_net
-- can POST anywhere, so Postgres schedules the Vercel endpoint directly.
--
-- Run the block below ONCE in the Supabase SQL editor, with your own values.
-- It is left commented because it needs secrets that must not live in a
-- migration file committed to git.
--
--   -- a) store the shared secret (must equal CRON_SECRET in Vercel)
--   SELECT vault.create_secret('<the same value as CRON_SECRET>', 'usms_cron_secret');
--   SELECT vault.create_secret('https://<your-app>.vercel.app', 'usms_app_url');
--
--   -- b) schedule the dispatcher every minute
--   SELECT cron.schedule(
--     'dispatch-notification-emails',
--     '* * * * *',
--     $job$
--     SELECT net.http_post(
--       url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
--                    WHERE name = 'usms_app_url') || '/api/notifications/dispatch',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (SELECT decrypted_secret
--                                         FROM vault.decrypted_secrets
--                                         WHERE name = 'usms_cron_secret')
--       ),
--       body    := '{}'::jsonb,
--       timeout_milliseconds := 20000
--     );
--     $job$
--   );
--
--   -- c) sweep abandoned sends every 10 minutes
--   SELECT cron.schedule(
--     'reap-stuck-notification-emails',
--     '*/10 * * * *',
--     $job$ SELECT public.reap_stuck_email_sends(10); $job$
--   );
--
-- Prerequisites (Database -> Extensions in the dashboard): pg_cron, pg_net.
-- To inspect:  SELECT * FROM cron.job;
--              SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- ------------------------------------------------------------
-- 7. PREFERENCES CONTRACT
-- ------------------------------------------------------------
-- 00012 named five types that bypass preferences. Two more belong on that
-- list and the omission looks like an oversight rather than a decision:
--   * hearing_rescheduled — if a student cannot mute the summons, they
--     cannot mute the summons moving to a different day.
--   * case_resolved — under Rules on Discipline Sec. 9 the ten-day appeal
--     window runs from receipt of the decision. Muting it mutes the clock.
-- settlement_ready and clearance_on_hold join them on the same principle:
-- anything that creates a deadline or an obligation is not optional mail.
-- The authoritative list lives in src/lib/notifications/policy.ts, which is
-- unit-tested; this comment must be kept in step with it.
COMMENT ON TABLE public.notification_preferences IS
  'Channel preferences for optional mail. Notifications that create an obligation or start a deadline — case_filed, hearing_scheduled, hearing_rescheduled, hearing_reminder, apology_required, sanction_applied, settlement_ready, case_resolved, clearance_on_hold — bypass these settings entirely. A student cannot opt out of a summons, and cannot opt out of the notice that starts their appeal window. Enforced in src/lib/notifications/policy.ts.';
