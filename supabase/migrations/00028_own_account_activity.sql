-- ============================================================
-- 00028: USERS SEE THEIR OWN SIGN-IN HISTORY
-- ============================================================
-- Settings now shows each user when and from where their account was used:
-- sign-ins, password changes, passwords set from a one-time link, and reset
-- links asked for from the sign-in page. All four are already written to
-- audit_logs against the account they are about.
--
-- Until now only staff could read audit_logs (00001, "Staff can view audit
-- logs"). This adds a second, narrower SELECT policy: a user may read their
-- own rows of those four kinds and nothing else — not what they did to
-- other records, and not anyone else's activity. Policies are OR-ed, so
-- staff keep their existing access.
--
-- The table stays append-only: still no UPDATE or DELETE policy.
-- ============================================================

DROP POLICY IF EXISTS "users read own account activity" ON public.audit_logs;
CREATE POLICY "users read own account activity" ON public.audit_logs
  FOR SELECT USING (
    user_id = auth.uid()
    AND action IN ('login', 'password_change', 'account_activated', 'password_reset_requested')
  );

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'audit_logs';
--   -- expect "users read own account activity" (SELECT) beside the 00001 policies
