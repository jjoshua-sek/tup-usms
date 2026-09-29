-- ============================================================
-- 00024: STUDENTS SEE STAFF NAMES, NOT STAFF RECORDS
-- ============================================================
-- 00001 created "All authenticated can view staff names" as
--   FOR SELECT USING (auth.role() = 'authenticated')
-- RLS filters rows, not columns, so despite its name the policy let every
-- signed-in student read every column of every staff row: role_type,
-- can_access_confidential (that is, who is cleared for CODI matters),
-- employee_id, department, office and user_id. 00013 treats the existence
-- of a CODI case as sensitive; the list of people who could be handling
-- one is no less so.
--
-- The only thing a student page needs from staff is a responder's name on
-- their own concern thread (/concerns/[id]). That now comes from
-- staff_names(), which returns user_id and full_name and nothing else.
--
-- The table itself stays readable by:
--   * each staff member, their own row   "Staff can view own record" (00001)
--   * any staff member, every row        "Staff can view all staff"  (below)
--   * administrators, every row          "Admin can manage staff"    (00001)
-- Staff screens (the Accounts list, audit-log actor names, the header,
-- getStaffContext) all read as staff, so nothing they show changes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Names for students
-- ------------------------------------------------------------
-- Takes ids rather than returning the whole directory: it resolves the
-- people whose ids the caller already holds — for a student, whoever has
-- replied on their concerns — and cannot be used to list everyone.
CREATE OR REPLACE FUNCTION public.staff_names(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, full_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.user_id, s.full_name
  FROM public.staff s
  WHERE s.user_id = ANY (p_user_ids);
$$;

-- Supabase grants EXECUTE on new public functions to anon directly, so
-- revoking from PUBLIC alone would leave this callable without signing in.
REVOKE ALL ON FUNCTION public.staff_names(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_names(UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- 2. The table itself: staff and administrators only
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "All authenticated can view staff names" ON public.staff;

-- is_staff() is SECURITY DEFINER, so calling it from a policy on the same
-- table reads staff as the owner and does not recurse into this policy.
DROP POLICY IF EXISTS "Staff can view all staff" ON public.staff;
CREATE POLICY "Staff can view all staff" ON public.staff
  FOR SELECT USING (public.is_staff());

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT policyname, cmd, qual FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'staff' ORDER BY policyname;
--   -- Admin can manage staff / Staff can view all staff / Staff can view own record
--
--   -- Signed in as a student: no staff rows, but every name resolves.
--   -- The student must not also have a staff row (a test admin may have
--   -- both), or is_staff() is true and every staff row is visible.
--   BEGIN;
--   SELECT set_config('request.jwt.claims', json_build_object(
--            'sub', (SELECT s.user_id FROM public.students s
--                    WHERE NOT EXISTS (SELECT 1 FROM public.staff t WHERE t.user_id = s.user_id)
--                    LIMIT 1),
--            'role', 'authenticated')::text, true);
--   SELECT set_config('verify.staff_ids',
--            (SELECT string_agg(user_id::text, ',') FROM public.staff), true);
--   SET LOCAL ROLE authenticated;
--   SELECT auth.uid() AS acting_as,                                     -- not null
--          public.is_staff() AS acting_as_staff,                        -- false
--          (SELECT count(*) FROM public.staff) AS staff_rows_visible,   -- 0
--          (SELECT count(*) FROM public.staff_names(
--             string_to_array(current_setting('verify.staff_ids'), ',')::uuid[])) AS names_resolved;
--   ROLLBACK;
