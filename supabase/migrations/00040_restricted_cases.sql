-- ============================================================
-- 00040 — Confidential cases the OSA handles itself
-- ============================================================
-- OSA checklist A7. Three of the four researchers said harassment and
-- similar cases go straight to CODI, hidden from other OSA staff; the OSA's
-- former student-body partner and one other said the OSA handles them. The
-- team chose to split by type:
--
--   * Sexual harassment (CON-01) and gender-based violence (CON-02) stay
--     with CODI, hidden as before: RA 7877 and the Safe Spaces Act
--     (RA 11313) require schools to handle them through a CODI.
--   * Discrimination (CON-03) is handled by the OSA, as a restricted case:
--     visible only to the OSA head, the administrator, and the officer
--     assigned to it (and, as before, to whoever filed it). The student
--     still sees their own case.
--
-- 'restricted' was already one of the confidentiality values (00007); this
-- is the first use of it.
-- ============================================================

UPDATE public.violation_types SET auto_route_codi = FALSE WHERE code = 'CON-03';

-- Whether the signed-in staff member may see a restricted case.
CREATE OR REPLACE FUNCTION public.can_read_restricted_case(p_assigned_officer UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_staff_role() IN ('osa_head', 'admin')
      OR (p_assigned_officer IS NOT NULL AND p_assigned_officer = public.current_staff_id());
$$;

REVOKE ALL ON FUNCTION public.can_read_restricted_case(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_restricted_case(UUID) TO authenticated;

-- OSA staff see normal cases, and restricted ones they are cleared for.
DROP POLICY IF EXISTS "osa reads cases" ON public.violation_cases;
CREATE POLICY "osa reads cases" ON public.violation_cases
  FOR SELECT USING (
    public.is_osa_staff()
    AND (
      confidentiality = 'normal'
      OR (confidentiality = 'restricted' AND public.can_read_restricted_case(assigned_officer_id))
    )
  );

DROP POLICY IF EXISTS "osa updates cases" ON public.violation_cases;
CREATE POLICY "osa updates cases" ON public.violation_cases
  FOR UPDATE USING (
    (public.is_osa_staff() AND confidentiality = 'normal')
    OR (public.is_osa_staff() AND confidentiality = 'restricted' AND public.can_read_restricted_case(assigned_officer_id))
    OR (confidentiality = 'codi' AND public.can_access_confidential())
  );
