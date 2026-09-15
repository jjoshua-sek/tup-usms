-- ============================================================
-- Migration 00014: Fix profile-setup blockers
-- ============================================================
-- Three bugs preventing students from completing the profile wizard.
--
-- ROOT CAUSE for bugs 2 and 3: dual-layer validation drift. The Zod
-- schemas were relaxed to accept realistic Filipino input formats, but the
-- database CHECK constraints from the original schema were never updated
-- to match. The form accepted values Postgres then rejected — producing a
-- failure the student had no way to diagnose.
--
-- The lesson worth carrying: when validation lives in two layers, they
-- must move together, or the looser layer becomes a trap.
-- ============================================================

-- ============================================================
-- 1. UNIQUE constraint on students.user_id
-- ============================================================
-- saveProfileStep1 uses upsert({ onConflict: "user_id" }), which requires a
-- UNIQUE constraint or index on that column. The original schema created
-- only a plain index, so every upsert failed with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- A UNIQUE constraint is correct modeling regardless: one student profile
-- per auth user.
DO $$
BEGIN
  -- Guard against pre-existing duplicates, which would make the constraint
  -- creation fail with a confusing error. Should be zero rows in practice.
  IF EXISTS (
    SELECT user_id FROM public.students
    GROUP BY user_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate students.user_id rows exist. Resolve them before adding the UNIQUE constraint.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_user_id_unique'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- ============================================================
-- 2. Relax the cellphone format constraint
-- ============================================================
-- Original: CHECK (cellphone ~ '^\+63\d{10}$') — required exactly
-- "+639171234567" with no spaces, dashes, or the common local "09..." form.
--
-- Filipinos write mobile numbers as 09171234567, +63 917 123 4567,
-- 0917-123-4567, and several other ways. Rejecting all but one of them at
-- the database layer is user-hostile, and the application now normalizes
-- to +63 format on save anyway. The constraint's job here is to reject
-- obvious garbage, not to enforce presentation.
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_cellphone_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_cellphone_check
  CHECK (
    cellphone IS NULL
    OR cellphone = ''
    -- Digits, spaces, dashes, parens, optional leading +. 7–20 characters.
    OR cellphone ~ '^[+]?[0-9][0-9 ()\-]{6,19}$'
  );

-- ============================================================
-- 3. Relax the ZIP code constraint
-- ============================================================
-- Original required exactly 4 digits. Philippine ZIPs are 4 digits, but
-- the Zod schema was widened to 3–6 to tolerate transcription variance and
-- any non-PH address a transferee might carry. Aligning the DB to match.
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_address_zip_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_address_zip_check
  CHECK (address_zip ~ '^\d{3,6}$');

-- ============================================================
-- 4. Relax the LRN constraint
-- ============================================================
-- Original required exactly 12 digits with no allowance for an empty
-- string. The profile form submits '' when the student skips the field
-- (many do not know their LRN offhand), which violated the check.
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_lrn_check;

ALTER TABLE public.students
  ADD CONSTRAINT students_lrn_check
  CHECK (lrn IS NULL OR lrn = '' OR lrn ~ '^\d{12}$');

-- ============================================================
-- 5. Allow placeholder academic values during onboarding
-- ============================================================
-- department/program/year_level are NOT NULL, but a student completing
-- Step 1 has not reached the academic step yet. saveProfileStep1 inserts
-- 'TBD' placeholders, which the Registrar later corrects. Documenting that
-- intent so a future reader does not mistake 'TBD' rows for corrupt data.
COMMENT ON COLUMN public.students.department IS
  'Set by the Registrar. May hold the placeholder ''TBD'' between profile Step 1 and Registrar assignment.';
COMMENT ON COLUMN public.students.program IS
  'Set by the Registrar. May hold the placeholder ''TBD'' between profile Step 1 and Registrar assignment.';

-- ============================================================
-- VERIFY
-- ============================================================
-- After running, confirm the constraints are as expected:
--
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.students'::regclass
--     AND conname IN (
--       'students_user_id_unique',
--       'students_cellphone_check',
--       'students_address_zip_check',
--       'students_lrn_check'
--     );
