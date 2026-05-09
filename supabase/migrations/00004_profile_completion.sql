-- ============================================================
-- Migration 00004: Profile Completion Tracking
-- ============================================================
-- Adds two columns to support the 4-step profile wizard:
--
-- 1. photo_is_provisional: marks a photo captured via webcam as
--    "this is a placeholder, I'll replace it later." Drives the
--    persistent reminder banner on /profile and the dot indicator
--    on the avatar in the sidebar/topbar.
--
-- 2. dpa_consent_date: when the student explicitly clicked
--    "I agree" in the DPA consent dialog. Required by RA 10173 —
--    consent must be timestamped for audit purposes.
-- 3. profile_completed_at: when the student finished all 4
--    wizard steps. Used by gating logic (middleware + dashboard)
--    to decide whether to force-redirect to /profile.
--
-- SAFE TO RE-RUN: idempotent (uses ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- Use DO block so we can guard each ALTER with IF NOT EXISTS check
-- (Postgres ALTER TABLE doesn't support IF NOT EXISTS for columns
--  pre-PG16, so we check pg_attribute manually.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'photo_is_provisional'
  ) THEN
    ALTER TABLE public.students
      ADD COLUMN photo_is_provisional BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'dpa_consent_date'
  ) THEN
    ALTER TABLE public.students
      ADD COLUMN dpa_consent_date TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'profile_completed_at'
  ) THEN
    ALTER TABLE public.students
      ADD COLUMN profile_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Index for fast "is this profile complete?" lookups
CREATE INDEX IF NOT EXISTS idx_students_profile_completed
  ON public.students (profile_completed_at)
  WHERE profile_completed_at IS NOT NULL;

-- Index for the provisional-photo dashboard query
CREATE INDEX IF NOT EXISTS idx_students_photo_provisional
  ON public.students (photo_is_provisional)
  WHERE photo_is_provisional = TRUE;
