-- ============================================================
-- 00026: create_notification IS FOR THE SERVICE ROLE ONLY
-- ============================================================
-- create_notification (00012) is SECURITY DEFINER, so it writes past RLS,
-- and it checks nothing about its caller. It inserts a notification for
-- whatever p_user_id it is given, with the caller's own title, body and
-- action_url, and when p_channels includes 'email' it sets email_status to
-- 'queued' — so the dispatcher (src/lib/notifications/dispatch.ts) sends it
-- from the institutional Gmail account.
--
-- 00012 granted it TO authenticated and never revoked anything. Supabase's
-- default privileges had already granted EXECUTE to anon directly, so any
-- signed-in student, and anyone holding the public anon key, could POST
-- /rest/v1/rpc/create_notification and have the university email any user
-- an official-looking message with a link of their choosing.
--
-- Callers are unaffected. All fourteen call sites are staff server actions
-- (src/app/staff/cases/actions.ts, cases/sanction-actions.ts,
-- clearance/actions.ts, documents/actions.ts, id-validation/actions.ts,
-- scholarships/actions.ts); each checks getStaffContext() and then calls it
-- through createAdminClient(), which is service_role. No migration calls it
-- from SQL, and a pg_cron job that did would run as postgres, the owner.
--
-- Same statements as 00015 and 00025. src/lib/notifications/queue-grants.test.ts
-- fails if a later migration leaves it callable by anyone else.
-- ============================================================

REVOKE ALL ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, UUID)
  TO service_role;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT has_function_privilege('anon',          p, 'EXECUTE') AS anon,           -- false
--          has_function_privilege('authenticated', p, 'EXECUTE') AS authenticated,  -- false
--          has_function_privilege('service_role',  p, 'EXECUTE') AS service_role    -- true
--   FROM (SELECT 'public.create_notification(uuid,text,text,text,text,text[],text,text,text,uuid)'::regprocedure AS p) f;
