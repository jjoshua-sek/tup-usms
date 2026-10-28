-- ============================================================
-- 00051 — Only OSA staff manage hearings, and only on cases they can see
-- ============================================================
-- 00013 gave case_hearings two staff policies:
--
--   "staff reads hearings"   FOR SELECT, hearings on cases the caller can see
--   "staff manages hearings" FOR ALL,    public.is_staff()
--
-- Permissive policies are OR'ed, and FOR ALL includes SELECT, so the second
-- one let any staff account (faculty, security, cashier, UITC) read, change
-- and delete every hearing through the API, including hearings of CODI and
-- restricted cases (00040) that violation_cases hides from them.
--
-- The write policies below replace it: OSA staff, on hearings whose case
-- they can see. "staff reads hearings" and the two student policies stay as
-- they are. The app sets, approves and summons hearings with the service
-- role (approveHearing included, so faculty complainants still approve
-- dates); the only write made with a user's own session is the student's
-- acknowledgement, which "student acknowledges hearing" covers.
-- ============================================================

DROP POLICY IF EXISTS "staff manages hearings" ON public.case_hearings;

DROP POLICY IF EXISTS "osa schedules hearings" ON public.case_hearings;
CREATE POLICY "osa schedules hearings" ON public.case_hearings
  FOR INSERT WITH CHECK (
    public.is_osa_staff()
    AND case_id IN (SELECT id FROM public.violation_cases)  -- inherits case RLS
  );

-- WITH CHECK as well as USING, so a hearing cannot be moved onto a case the
-- officer cannot see.
DROP POLICY IF EXISTS "osa updates hearings" ON public.case_hearings;
CREATE POLICY "osa updates hearings" ON public.case_hearings
  FOR UPDATE
  USING (
    public.is_osa_staff()
    AND case_id IN (SELECT id FROM public.violation_cases)
  )
  WITH CHECK (
    public.is_osa_staff()
    AND case_id IN (SELECT id FROM public.violation_cases)
  );

DROP POLICY IF EXISTS "osa deletes hearings" ON public.case_hearings;
CREATE POLICY "osa deletes hearings" ON public.case_hearings
  FOR DELETE USING (
    public.is_osa_staff()
    AND case_id IN (SELECT id FROM public.violation_cases)
  );
