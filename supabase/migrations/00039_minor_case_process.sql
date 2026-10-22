-- ============================================================
-- 00039 — The officer chooses how a minor case is handled
-- ============================================================
-- OSA checklist A4. All five researchers accept counselling followed by a
-- written apology, which stays the default. The OSA's former student-body
-- partner added that some minor cases end with an apology letter only, or
-- with a warning only, and the OSA told us it prefers leniency for minor
-- offenses such as an unvalidated ID.
--
-- 1. minor_process: the officer's choice for a minor case.
--      counselling_apology  counselling, then an apology letter (default)
--      apology_only         an apology letter, no counselling session
--      warning_only         a written warning; the case closes at once
--    NULL means not chosen yet, which behaves as counselling_apology.
-- 2. resolution_path gains apology_only and warning_only, so a closed case
--    says which way it was closed.
-- ============================================================

ALTER TABLE public.violation_cases
  ADD COLUMN IF NOT EXISTS minor_process TEXT
    CHECK (minor_process IS NULL OR minor_process IN ('counselling_apology', 'apology_only', 'warning_only'));

-- The old list was an unnamed CHECK, so it is found by what it says rather
-- than by a guessed name (closed_requires_resolution also mentions
-- resolution_path, but not the list, and is kept).
DO $$
DECLARE
  existing RECORD;
BEGIN
  FOR existing IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.violation_cases'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%resolution_path%'
      AND pg_get_constraintdef(oid) LIKE '%counselling_apology%'
  LOOP
    EXECUTE format('ALTER TABLE public.violation_cases DROP CONSTRAINT %I', existing.conname);
  END LOOP;
END $$;

ALTER TABLE public.violation_cases
  ADD CONSTRAINT violation_cases_resolution_path_check CHECK (
    resolution_path IS NULL OR resolution_path IN (
      'counselling_apology', 'apology_only', 'warning_only',
      'mediation_settlement', 'pic_sdb', 'codi_referral', 'dismissed'
    )
  );

COMMENT ON COLUMN public.violation_cases.minor_process IS
  'How a minor case is handled (checklist A4): counselling_apology (default), apology_only, or warning_only.';
