-- ============================================================
-- TUP-Manila USMS — Development Seed Data
-- ============================================================
-- Run this AFTER schema migration in Supabase SQL Editor.
-- This script is idempotent — safe to re-run.
--
-- It seeds:
--   1. Sample subjects (BSIT curriculum)
--   2. Sample sections (BSIT, BSCS, BSCE)
--   3. Sample calendar events (only if at least one auth user exists)
--
-- After creating your first admin user via the Supabase Dashboard
-- (Authentication → Users → Add user), re-run this file to populate
-- the calendar events (or run the calendar block separately).
-- ============================================================

-- ============================================================
-- 1. SAMPLE SUBJECTS (BSIT Curriculum)
-- ============================================================
INSERT INTO subjects (subject_code, description, lec_units, lab_units, curriculum_year, semester, year_level) VALUES
  ('CC 101', 'Introduction to Computing', 2, 1, '2021', '1st Semester', '1st Year'),
  ('CC 102', 'Computer Programming 1', 2, 1, '2021', '1st Semester', '1st Year'),
  ('MATH 101', 'Mathematics in the Modern World', 3, 0, '2021', '1st Semester', '1st Year'),
  ('ENGL 101', 'Purposive Communication', 3, 0, '2021', '1st Semester', '1st Year'),
  ('PE 101', 'Physical Education 1', 0, 2, '2021', '1st Semester', '1st Year'),
  ('NSTP 101', 'National Service Training Program 1', 0, 3, '2021', '1st Semester', '1st Year'),
  ('CC 103', 'Computer Programming 2', 2, 1, '2021', '2nd Semester', '1st Year'),
  ('CC 104', 'Data Structures and Algorithms', 2, 1, '2021', '2nd Semester', '1st Year'),
  ('MATH 102', 'Discrete Mathematics', 3, 0, '2021', '2nd Semester', '1st Year'),
  ('ENGL 102', 'Readings in Philippine History', 3, 0, '2021', '2nd Semester', '1st Year'),
  ('IT 201', 'Information Management', 2, 1, '2021', '1st Semester', '2nd Year'),
  ('IT 202', 'Networking 1', 2, 1, '2021', '1st Semester', '2nd Year'),
  ('IT 203', 'Web Development', 2, 1, '2021', '1st Semester', '2nd Year'),
  ('IT 204', 'Object-Oriented Programming', 2, 1, '2021', '2nd Semester', '2nd Year'),
  ('IT 205', 'Platform Technologies', 2, 1, '2021', '2nd Semester', '2nd Year'),
  ('IT 301', 'System Integration and Architecture', 2, 1, '2021', '1st Semester', '3rd Year'),
  ('IT 302', 'Information Assurance and Security', 3, 0, '2021', '1st Semester', '3rd Year'),
  ('IT 303', 'Application Development', 2, 1, '2021', '1st Semester', '3rd Year'),
  ('IT 401', 'Capstone Project 1', 0, 3, '2021', '1st Semester', '4th Year'),
  ('IT 402', 'Capstone Project 2', 0, 3, '2021', '2nd Semester', '4th Year')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. SAMPLE SECTIONS
-- ============================================================
INSERT INTO sections (section_code, program, year_level, semester, school_year) VALUES
  ('BSIT 1-1', 'BSIT', '1st Year', '1st Semester', '2025-2026'),
  ('BSIT 1-2', 'BSIT', '1st Year', '1st Semester', '2025-2026'),
  ('BSIT 2-1', 'BSIT', '2nd Year', '1st Semester', '2025-2026'),
  ('BSIT 3-1', 'BSIT', '3rd Year', '1st Semester', '2025-2026'),
  ('BSIT 4-1', 'BSIT', '4th Year', '1st Semester', '2025-2026'),
  ('BSCS 1-1', 'BSCS', '1st Year', '1st Semester', '2025-2026'),
  ('BSCE 1-1', 'BSCE', '1st Year', '1st Semester', '2025-2026')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. SAMPLE CALENDAR EVENTS
-- ============================================================
-- Wrapped in a DO block so it gracefully skips if no users exist yet.
-- Re-run this file after creating your first admin user to populate events.
DO $$
DECLARE
  admin_user_id UUID;
BEGIN
  -- Try to find an admin/staff user, fall back to any user
  SELECT id INTO admin_user_id
  FROM auth.users
  WHERE raw_user_meta_data->>'role' IN ('admin', 'staff')
  ORDER BY created_at ASC
  LIMIT 1;

  IF admin_user_id IS NULL THEN
    SELECT id INTO admin_user_id
    FROM auth.users
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF admin_user_id IS NULL THEN
    RAISE NOTICE 'No users found in auth.users — skipping calendar_events seed. Create a user via the Auth dashboard, then re-run this file.';
  ELSE
    INSERT INTO calendar_events (title, description, event_type, start_date, end_date, created_by) VALUES
      ('1st Semester Start', 'Classes begin for the 1st Semester AY 2025-2026', 'academic', '2025-08-18', '2025-08-18', admin_user_id),
      ('Enrollment Period', 'Online enrollment for continuing students', 'enrollment', '2025-07-15', '2025-08-01', admin_user_id),
      ('Midterm Exams', 'Midterm examination period', 'academic', '2025-10-13', '2025-10-17', admin_user_id),
      ('All Saints Day', 'Holiday - No classes', 'holiday', '2025-11-01', '2025-11-01', admin_user_id),
      ('Final Exams', 'Final examination period', 'academic', '2025-12-08', '2025-12-12', admin_user_id),
      ('Christmas Break', 'Semester break', 'holiday', '2025-12-15', '2026-01-04', admin_user_id),
      ('2nd Semester Start', 'Classes begin for the 2nd Semester', 'academic', '2026-01-05', '2026-01-05', admin_user_id),
      ('Faculty Evaluation Deadline', 'Complete all faculty evaluations', 'deadline', '2025-11-28', '2025-11-28', admin_user_id)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Calendar events seeded with creator: %', admin_user_id;
  END IF;
END $$;
