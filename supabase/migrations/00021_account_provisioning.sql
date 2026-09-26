-- ============================================================
-- 00021: ACCOUNT PROVISIONING
-- ============================================================
-- Until now nothing in the app created an account. Every student login had
-- to be made by hand in the Supabase dashboard, and every staff login by
-- hand in the dashboard plus two SQL statements. This migration backs the
-- admin Accounts screen (/staff/accounts):
--
--   * Bulk enrollment import — the registrar's enrollment list becomes one
--     auth account per student, and each student is emailed a one-time
--     sign-in link to set their own password.
--   * Individual creation — one student or staff account at a time, for
--     the cases a bulk list doesn't cover.
--
-- The sign-in link is never stored. account_invitations records THAT an
-- invitation is owed or was sent; the token itself is minted by the
-- dispatcher at the moment of sending (auth.admin.generateLink) and exists
-- only inside the email. A leaked table leaks no working credential, and
-- the link's expiry clock starts when it is sent, not when it was queued.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_invitations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Rows created by the same import share a batch id.
  batch_id        UUID,
  user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- From the enrollment list. Used to prefill the student's profile at
  -- first sign-in, so the registrar's record and the student's agree.
  student_number  TEXT NOT NULL UNIQUE CHECK (student_number ~ '^TUPM-\d{2}-\d{4}$'),
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  program         TEXT,
  year_level      TEXT,
  section         TEXT,

  -- Where the sign-in link goes: the personal address on the enrollment
  -- record, because a newly enrolled student's institutional mailbox may
  -- not exist yet. The login address remains <student_number>@tup.edu.ph.
  delivery_email  TEXT NOT NULL,

  -- queued / sending / sent / failed / undeliverable — the delivery cycle,
  --                                     same meaning as notifications (00019)
  -- activated        — the student used a link and set a password
  -- password_issued  — an admin set the password directly; no link sent
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'sending', 'sent', 'failed', 'undeliverable',
    'activated', 'password_issued'
  )),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  provider_id     TEXT,
  sent_at         TIMESTAMPTZ,
  activated_at    TIMESTAMPTZ,

  created_by      UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_queue
  ON public.account_invitations(created_at)
  WHERE status IN ('queued', 'failed', 'sending');
CREATE INDEX IF NOT EXISTS idx_invitations_batch
  ON public.account_invitations(batch_id)
  WHERE batch_id IS NOT NULL;

DROP TRIGGER IF EXISTS account_invitations_updated_at ON public.account_invitations;
CREATE TRIGGER account_invitations_updated_at
  BEFORE UPDATE ON public.account_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;

-- Only administrators manage accounts. The server actions also check this
-- in the application before touching the auth admin API.
DROP POLICY IF EXISTS "admin manages invitations" ON public.account_invitations;
CREATE POLICY "admin manages invitations" ON public.account_invitations
  FOR ALL USING (public.current_staff_role() = 'admin')
  WITH CHECK (public.current_staff_role() = 'admin');

-- A student reads their own row, so the profile form can be prefilled with
-- what the enrollment list says.
DROP POLICY IF EXISTS "student reads own invitation" ON public.account_invitations;
CREATE POLICY "student reads own invitation" ON public.account_invitations
  FOR SELECT USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- CLAIMING A BATCH
-- ------------------------------------------------------------
-- Same shape as claim_email_batch (00019): FOR UPDATE SKIP LOCKED so two
-- overlapping cron runs claim disjoint rows and no student is sent two
-- links. Rows stuck at 'sending' for ten minutes — a worker that crashed
-- mid-send — become claimable again here, which saves scheduling a second
-- reaper job.
CREATE OR REPLACE FUNCTION public.claim_invitation_batch(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  student_number  TEXT,
  first_name      TEXT,
  delivery_email  TEXT,
  login_email     TEXT,
  attempts        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.account_invitations i
    SET status   = 'sending',
        attempts = i.attempts + 1
    WHERE i.id IN (
      SELECT c.id
      FROM public.account_invitations c
      WHERE (
          c.status IN ('queued', 'failed')
          AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= NOW())
        )
        OR (c.status = 'sending' AND c.updated_at < NOW() - INTERVAL '10 minutes')
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING i.id, i.user_id, i.student_number, i.first_name, i.delivery_email, i.attempts
  )
  SELECT c.id, c.user_id, c.student_number, c.first_name, c.delivery_email,
         u.email::TEXT, c.attempts
  FROM claimed c
  JOIN auth.users u ON u.id = c.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invitation_batch(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_invitation_batch(INT) FROM authenticated;

COMMENT ON TABLE public.account_invitations IS
  'Accounts created from the admin Accounts screen and the delivery state of their one-time sign-in links. The link token is never stored: it is minted at send time and exists only in the email.';

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT to_regclass('public.account_invitations') IS NOT NULL AS table_ok,
--          EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_invitation_batch') AS claim_ok;
