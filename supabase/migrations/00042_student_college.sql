-- ============================================================
-- 00042 — Which college a student belongs to
-- ============================================================
-- OSA checklist I5: the OSA submits reports per college. STARS knew each
-- student's program but not their college. The Certificate of
-- Registration prints it ("Course BSIT ... College COS"), so it is read
-- from the COR when the OSA verifies one and saved here. A student with no
-- verified COR yet is counted under the college most students of the same
-- program have (shown as an estimate on the report).
-- ============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS college TEXT
    CHECK (college IS NULL OR college ~ '^[A-Z]{2,8}$');

COMMENT ON COLUMN public.students.college IS
  'College code as printed on the COR (e.g. COS, COE, CIT), set when the OSA verifies a COR.';
