-- ============================================================
-- 00022: PASSWORD RESET LINKS
-- ============================================================
-- Once a student had set up their account, nothing in the app could help
-- them if they forgot the password: the Accounts screen hid "Resend link"
-- for set-up accounts, and Supabase's own recovery email goes to the login
-- address (<student number>@tup.edu.ph), which may not be a real mailbox.
-- Resetting meant an administrator running SQL.
--
-- A reset reuses the one-time link from 00021: the same invitation row is
-- re-queued, the dispatcher mints a fresh token when it sends, and the
-- student chooses a new password on the same /activate page. The only
-- difference is the wording, which this column carries.
-- ============================================================

ALTER TABLE public.account_invitations
  ADD COLUMN IF NOT EXISTS link_purpose TEXT NOT NULL DEFAULT 'setup'
    CHECK (link_purpose IN ('setup', 'reset'));

COMMENT ON COLUMN public.account_invitations.link_purpose IS
  'setup: first sign-in, choose a password. reset: an administrator sent a link to choose a new one. Decides the email wording and where the student lands afterwards.';

-- The claim function now returns link_purpose. A function's result columns
-- cannot change in place, so it is dropped and recreated; the body is the
-- same as 00021 apart from the extra column.
DROP FUNCTION IF EXISTS public.claim_invitation_batch(INT);

CREATE FUNCTION public.claim_invitation_batch(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id              UUID,
  user_id         UUID,
  student_number  TEXT,
  first_name      TEXT,
  delivery_email  TEXT,
  login_email     TEXT,
  attempts        INT,
  link_purpose    TEXT
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
    RETURNING i.id, i.user_id, i.student_number, i.first_name, i.delivery_email,
              i.attempts, i.link_purpose
  )
  SELECT c.id, c.user_id, c.student_number, c.first_name, c.delivery_email,
         u.email::TEXT, c.attempts, c.link_purpose
  FROM claimed c
  JOIN auth.users u ON u.id = c.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invitation_batch(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_invitation_batch(INT) FROM authenticated;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT EXISTS (SELECT 1 FROM information_schema.columns
--                  WHERE table_name = 'account_invitations' AND column_name = 'link_purpose') AS column_ok,
--          pg_get_function_result('public.claim_invitation_batch(int)'::regprocedure) LIKE '%link_purpose%' AS claim_ok;
