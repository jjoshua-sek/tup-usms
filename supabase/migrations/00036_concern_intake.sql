-- ============================================================
-- 00036 — Concerns the OSA records for a student
-- ============================================================
-- OSA checklist D2: students raise concerns by walking in, by letter or
-- email, and through faculty, not only through the online form. Until now
-- only a student could create a concern, from the portal, so everything
-- that reached the OSA another way stayed on paper.
--
-- 1. received_via: how the concern reached the OSA. 'online' for the
--    student's own form (every existing row); the others are recorded by
--    OSA staff.
-- 2. recorded_by: the staff member who took it down.
-- 3. referred_by: for 'faculty', who referred the student (checklist E1:
--    faculty referral is how the OSA finds students who need help).
-- 4. OSA staff may insert a concern for any student, only as themselves and
--    only for a way other than 'online'.
-- 5. A student still inserts only their own concern, and now only as
--    'online' with no recorder or referrer: otherwise a student could file
--    one that claims an OSA officer took it down.
-- ============================================================

ALTER TABLE public.concerns
  ADD COLUMN IF NOT EXISTS received_via TEXT NOT NULL DEFAULT 'online'
    CHECK (received_via IN ('online', 'walk_in', 'letter', 'email', 'faculty')),
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referred_by TEXT
    CHECK (referred_by IS NULL OR char_length(referred_by) BETWEEN 2 AND 120);

COMMENT ON COLUMN public.concerns.received_via IS
  'How the concern reached the OSA: online (the student''s own form), walk_in, letter, email, or faculty (a referral).';

DROP POLICY IF EXISTS "OSA staff record concerns for students" ON public.concerns;
CREATE POLICY "OSA staff record concerns for students" ON public.concerns
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_osa_staff()
    AND recorded_by = public.current_staff_id()
    AND received_via <> 'online'
  );

DROP POLICY IF EXISTS "Students can insert own concerns" ON public.concerns;
CREATE POLICY "Students can insert own concerns" ON public.concerns
  FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid())
    AND received_via = 'online'
    AND recorded_by IS NULL
    AND referred_by IS NULL
  );
