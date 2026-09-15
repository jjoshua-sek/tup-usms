-- ============================================================
-- Migration 00006: Drop the Enrollment Module
-- ============================================================
-- CONTEXT: The research scope pivoted from a unified registration
-- system to an OSA-focused (Office of Student Affairs) system:
--
--   "Implementation of a Machine Learning-Based Early Warning System
--    for At-Risk Students with Integrated OSA Guidance, Scholarship,
--    and Student Violation Management System"
--
-- Enrollment, subject catalogs, class scheduling, and faculty
-- evaluation are no longer in scope. Academic performance data now
-- arrives via student-uploaded Certificate of Registration and
-- rating slips (see migration 00011), not a live enrollment system.
--
-- ⚠️ DESTRUCTIVE. All rows in these tables are permanently removed.
-- The full prior schema remains recoverable from git history at
-- supabase/migrations/00001_initial_schema.sql.
--
-- Dropped in dependency order (children before parents).
-- SAFE TO RE-RUN: every statement uses IF EXISTS.
-- ============================================================

-- Remove from the realtime publication first so replication slots
-- don't hold references to dropped relations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'enrollments'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.enrollments;
  END IF;
END $$;

-- 1. faculty_evaluations → references schedules + students
DROP TABLE IF EXISTS public.faculty_evaluations CASCADE;

-- 2. enrollments → references students, subjects, sections
DROP TABLE IF EXISTS public.enrollments CASCADE;

-- 3. schedules → references subjects, sections, staff
DROP TABLE IF EXISTS public.schedules CASCADE;

-- 4. sections (no remaining dependents)
DROP TABLE IF EXISTS public.sections CASCADE;

-- 5. subjects (no remaining dependents)
DROP TABLE IF EXISTS public.subjects CASCADE;

-- 6. graduation_applications → superseded by clearance_requests
--    (migration 00010), which models the Good Moral Certificate and
--    graduation clearance flows documented in the OSA process guide.
DROP TABLE IF EXISTS public.graduation_applications CASCADE;

-- 7. academic_records → superseded by academic_snapshots
--    (migration 00011), which is purpose-built as the ML feature source.
DROP TABLE IF EXISTS public.academic_records CASCADE;

-- ============================================================
-- Trim enrollment-era columns from students that no longer apply.
-- Retained: demographics + financial flags, because they are
-- scholarship-eligibility criteria and risk-model features.
-- ============================================================
ALTER TABLE public.students DROP COLUMN IF EXISTS section;

-- `scholastic_status` is retained: it is a risk-model feature
-- (probationary standing is a strong at-risk predictor) and is now
-- sourced from uploaded rating slips rather than the enrollment system.
COMMENT ON COLUMN public.students.scholastic_status IS
  'Regular | Probationary | Warning | Dismissed. Sourced from student-uploaded rating slips, verified by OSA staff. Used as a feature in the at-risk model.';

-- ============================================================
-- Expand staff with OSA-specific role types.
-- Drives routing, queue visibility, and confidential-case access.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff'
      AND column_name = 'role_type'
  ) THEN
    ALTER TABLE public.staff
      ADD COLUMN role_type TEXT NOT NULL DEFAULT 'osa_officer'
      CHECK (role_type IN (
        'osa_head',            -- Director of Student Affairs
        'osa_officer',         -- General OSA staff; handles cases + scholarships
        'guidance_counselor',  -- Counselling sessions; sees guidance notes
        'faculty',             -- Can file complaints; approves hearing schedules
        'pic_member',          -- Preliminary Investigation Committee
        'sdb_member',          -- Student Disciplinary Board
        'codi_member',         -- Committee on Decorum and Investigation
        'registrar',           -- Clearance verification support
        'cashier',             -- Fee settlement confirmation
        'admin'                -- System administrator
      ));
  END IF;

  -- Gate for confidential (CODI) cases. Per the OSA process document,
  -- sexual harassment and similar matters bypass the general grievance
  -- flow entirely and must not be visible in ordinary OSA queues.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff'
      AND column_name = 'can_access_confidential'
  ) THEN
    ALTER TABLE public.staff
      ADD COLUMN can_access_confidential BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- Institutional webmail used for summons dispatch (req #4).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff'
      AND column_name = 'institutional_email'
  ) THEN
    ALTER TABLE public.staff ADD COLUMN institutional_email TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_role_type ON public.staff(role_type);
