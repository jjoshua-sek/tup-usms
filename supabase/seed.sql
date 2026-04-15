-- ============================================================
-- TUP-Manila USMS — Development Seed Data
-- ============================================================
-- Run this AFTER schema migration in Supabase SQL Editor.
-- Creates test users and sample data for development.
--
-- Test Accounts:
--   Student: TUPM-21-0001 / TestPass123!
--   Staff:   admin@tup.edu.ph / AdminPass123!
-- ============================================================

-- Note: In production, users are created through Supabase Auth.
-- For development, create users via the Supabase Dashboard or Auth API,
-- then run this seed to populate the related tables.

-- ============================================================
-- SAMPLE SUBJECTS (BSIT Curriculum)
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
-- SAMPLE SECTIONS
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
-- SAMPLE CALENDAR EVENTS
-- ============================================================
-- Note: created_by will need a valid user UUID after auth setup
-- These are placeholder dates for the 2025-2026 academic year
INSERT INTO calendar_events (title, description, event_type, start_date, end_date, created_by) VALUES
  ('1st Semester Start', 'Classes begin for the 1st Semester AY 2025-2026', 'academic', '2025-08-18', '2025-08-18', '00000000-0000-0000-0000-000000000000'),
  ('Enrollment Period', 'Online enrollment for continuing students', 'enrollment', '2025-07-15', '2025-08-01', '00000000-0000-0000-0000-000000000000'),
  ('Midterm Exams', 'Midterm examination period', 'academic', '2025-10-13', '2025-10-17', '00000000-0000-0000-0000-000000000000'),
  ('All Saints Day', 'Holiday - No classes', 'holiday', '2025-11-01', '2025-11-01', '00000000-0000-0000-0000-000000000000'),
  ('Final Exams', 'Final examination period', 'academic', '2025-12-08', '2025-12-12', '00000000-0000-0000-0000-000000000000'),
  ('Christmas Break', 'Semester break', 'holiday', '2025-12-15', '2026-01-04', '00000000-0000-0000-0000-000000000000'),
  ('2nd Semester Start', 'Classes begin for the 2nd Semester', 'academic', '2026-01-05', '2026-01-05', '00000000-0000-0000-0000-000000000000'),
  ('Faculty Evaluation Deadline', 'Complete all faculty evaluations', 'deadline', '2025-11-28', '2025-11-28', '00000000-0000-0000-0000-000000000000')
ON CONFLICT DO NOTHING;
