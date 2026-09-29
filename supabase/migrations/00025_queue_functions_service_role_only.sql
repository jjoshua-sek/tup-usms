-- ============================================================
-- 00025: QUEUE FUNCTIONS ARE FOR THE SERVICE ROLE ONLY
-- ============================================================
-- The claim_* and reap_* functions drain the app's work queues. They are
-- SECURITY DEFINER, so they run past RLS, and each hands back what it
-- claims while marking it taken:
--   claim_email_batch        other users' notifications and email addresses
--   claim_invitation_batch   student numbers, first names, delivery and
--                            login emails — and sets each row to 'sending',
--                            so the real dispatcher skips it
--   claim_concern_summaries  concern subjects and bodies
--   reap_stuck_email_sends   requeues every in-flight email
--
-- 00019, 00021, 00022 and 00023 revoked them FROM PUBLIC and FROM
-- authenticated, but never FROM anon. Supabase's default privileges grant
-- EXECUTE on each new public function to anon, authenticated and
-- service_role directly, not through PUBLIC, so anon kept its own grant:
-- anyone holding the public anon key could POST /rest/v1/rpc/<name>.
-- (00022 dropped and recreated claim_invitation_batch, which restored the
-- defaults all over again.)
--
-- Callers are unaffected. The dispatchers call these through
-- createAdminClient() (src/lib/notifications/dispatch.ts,
-- src/lib/accounts/invitations.ts, src/lib/concerns/summarize.ts), which
-- is service_role, and the pg_cron reaper runs as postgres, the owner.
--
-- Same statements as 00015 uses for record_access_anomaly and
-- purge_access_events. src/lib/notifications/queue-grants.test.ts fails if
-- a later claim_ or reap_ function is left callable by anyone else.
-- ============================================================

REVOKE ALL ON FUNCTION public.claim_email_batch(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_batch(INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.reap_stuck_email_sends(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stuck_email_sends(INT) TO service_role;

REVOKE ALL ON FUNCTION public.claim_invitation_batch(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invitation_batch(INT) TO service_role;

REVOKE ALL ON FUNCTION public.claim_concern_summaries(INT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_concern_summaries(INT, UUID, BOOLEAN) TO service_role;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT p.oid::regprocedure AS function,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,           -- false
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,  -- false
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role   -- true
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname ~ '^(claim|reap)_'
--   ORDER BY 1;
