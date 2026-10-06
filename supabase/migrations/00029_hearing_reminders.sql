-- ============================================================
-- 00029: HEARING REMINDERS
-- ============================================================
-- 'hearing_reminder' has been a notification type since 00012, and is on
-- the always-deliver list, but nothing ever sent one. The dispatch job
-- (/api/notifications/dispatch, every minute) now reminds the student and
-- the faculty complainant before a scheduled hearing: by default 24 hours
-- ahead, set with HEARING_REMINDER_HOURS.
--
-- reminder_sent_at is how a hearing is reminded once. The job claims a
-- hearing with
--   UPDATE case_hearings SET reminder_sent_at = now()
--   WHERE id = … AND reminder_sent_at IS NULL
-- so when two runs overlap, the second finds the column already set and
-- sends nothing. A new date is a new case_hearings row (both the scheduler
-- and the manual booking insert one), so it gets its own reminder.
-- ============================================================

ALTER TABLE public.case_hearings
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.case_hearings.reminder_sent_at IS
  'When the hearing reminder went out (src/lib/osa/hearing-reminders.ts). NULL = not yet.';

-- The job's question every minute: which notified hearings start soon and
-- have not been reminded? Partial, so it stays as small as that answer.
CREATE INDEX IF NOT EXISTS idx_case_hearings_reminder_due
  ON public.case_hearings (scheduled_start)
  WHERE reminder_sent_at IS NULL
    AND status IN ('student_notified', 'student_acknowledged', 'confirmed');

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'case_hearings'
--     AND column_name = 'reminder_sent_at';           -- one row, timestamp with time zone
