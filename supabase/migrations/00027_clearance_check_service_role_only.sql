-- ============================================================
-- 00027: check_student_clearance IS FOR THE SERVICE ROLE ONLY
-- ============================================================
-- check_student_clearance (00010, redefined in 00018) is SECURITY DEFINER,
-- so it reads violation_cases and community_service_assignments past RLS,
-- and it checks nothing about its caller. Given any student's id it returns
-- their open case numbers, classifications, statuses and incident dates —
-- and pending_cases counts CODI cases too, the very cases 00013 keeps
-- invisible even as a count.
--
-- 00010 and 00018 granted it TO authenticated and never revoked anything,
-- and Supabase's default privileges had already granted EXECUTE to anon
-- directly. So any signed-in student, or anyone holding the public anon key
-- and a student's id, could POST /rest/v1/rpc/check_student_clearance and
-- read that student's disciplinary standing.
--
-- The one caller is unaffected: runClearanceCheck
-- (src/app/staff/clearance/actions.ts) checks getStaffContext() for an OSA
-- role and then calls it through createAdminClient(), which is service_role.
-- The student-side clearance request deliberately never runs the check.
--
-- Same statements as 00025 and 00026. src/lib/notifications/queue-grants.test.ts
-- fails if a later migration leaves it callable by anyone else.
-- ============================================================

REVOKE ALL ON FUNCTION public.check_student_clearance(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_student_clearance(UUID) TO service_role;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT has_function_privilege('anon',          p, 'EXECUTE') AS anon,           -- false
--          has_function_privilege('authenticated', p, 'EXECUTE') AS authenticated,  -- false
--          has_function_privilege('service_role',  p, 'EXECUTE') AS service_role    -- true
--   FROM (SELECT 'public.check_student_clearance(uuid)'::regprocedure AS p) f;
