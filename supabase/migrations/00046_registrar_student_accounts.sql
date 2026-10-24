-- ============================================================
-- 00046 — The Registrar or UITC creates student accounts
-- ============================================================
-- OSA checklist I1: the OSA's former student-body partner said student
-- accounts are made by the Registrar and UITC, from the enrollment list
-- they already hold; most of the team said an OSA administrator does it.
-- Both now can. A 'registrar' staff account (the role exists since 00006;
-- shown as "Registrar / UITC") may import enrollment lists, create single
-- student accounts and resend setup links, and nothing else: it is not OSA
-- staff, so every case, concern, counselling and ID record stays closed to
-- it by the existing policies.
--
-- Invitations also carry staff password resets. A registrar sees and
-- manages only students' invitations, never a staff member's.
-- ============================================================

DROP POLICY IF EXISTS "registrar manages student invitations" ON public.account_invitations;
CREATE POLICY "registrar manages student invitations" ON public.account_invitations
  FOR ALL
  USING (
    public.current_staff_role() = 'registrar'
    AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = account_invitations.user_id)
  )
  WITH CHECK (
    public.current_staff_role() = 'registrar'
    AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = account_invitations.user_id)
  );
