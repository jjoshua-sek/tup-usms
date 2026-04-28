-- ============================================================
-- TUP-Manila Unified Student Management System
-- Database Schema — Initial Migration
-- ============================================================
-- Run this in the Supabase SQL Editor to create all tables,
-- RLS policies, indexes, triggers, and functions.
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. STUDENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_number TEXT NOT NULL UNIQUE,
  last_name     TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  middle_name   TEXT,
  name_extension TEXT,
  birth_date    DATE NOT NULL,
  birth_place   TEXT,
  gender        TEXT NOT NULL CHECK (gender IN ('Male','Female','Other','Prefer not to say')),
  citizenship   TEXT NOT NULL DEFAULT 'FILIPINO',
  religion      TEXT,
  civil_status  TEXT CHECK (civil_status IN ('Single','Married','Widowed','Separated') OR civil_status IS NULL),
  height_cm     INT CHECK (height_cm IS NULL OR (height_cm >= 50 AND height_cm <= 300)),
  weight_lbs    INT CHECK (weight_lbs IS NULL OR (weight_lbs >= 30 AND weight_lbs <= 1000)),
  lrn           TEXT CHECK (lrn IS NULL OR lrn ~ '^\d{12}$'),
  cellphone     TEXT CHECK (cellphone IS NULL OR cellphone ~ '^\+63\d{10}$'),
  email_address TEXT NOT NULL,
  address_unit  TEXT,
  address_street TEXT,
  address_barangay TEXT NOT NULL,
  address_city  TEXT NOT NULL,
  address_province TEXT NOT NULL,
  address_zip   TEXT NOT NULL CHECK (address_zip ~ '^\d{4}$'),
  congressional_district TEXT,
  financial_support TEXT,
  sponsor_name  TEXT,
  is_indigenous BOOLEAN NOT NULL DEFAULT FALSE,
  is_pwd        BOOLEAN NOT NULL DEFAULT FALSE,
  is_listahan   BOOLEAN NOT NULL DEFAULT FALSE,
  campus        TEXT NOT NULL DEFAULT 'Manila',
  department    TEXT NOT NULL,
  program       TEXT NOT NULL,
  year_level    TEXT NOT NULL,
  section       TEXT,
  scholastic_status TEXT NOT NULL DEFAULT 'Regular',
  qr_hash       TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  photo_url     TEXT,
  dpa_consent   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_student_number ON students(student_number);
CREATE INDEX idx_students_department ON students(department);
CREATE INDEX idx_students_program ON students(program);
CREATE INDEX idx_students_qr_hash ON students(qr_hash);

-- ============================================================
-- 2. STAFF TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id  TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  department   TEXT NOT NULL,
  position     TEXT NOT NULL,
  office       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_staff_user_id ON staff(user_id);
CREATE INDEX idx_staff_employee_id ON staff(employee_id);

-- ============================================================
-- 3. SUBJECTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_code    TEXT NOT NULL,
  description     TEXT NOT NULL,
  lec_units       INT NOT NULL DEFAULT 0 CHECK (lec_units >= 0),
  lab_units       INT NOT NULL DEFAULT 0 CHECK (lab_units >= 0),
  total_units     INT NOT NULL GENERATED ALWAYS AS (lec_units + lab_units) STORED,
  prerequisite    TEXT,
  equiv_code      TEXT,
  curriculum_year TEXT NOT NULL,
  semester        TEXT NOT NULL,
  year_level      TEXT NOT NULL,
  UNIQUE(subject_code, curriculum_year)
);

CREATE INDEX idx_subjects_code ON subjects(subject_code);
CREATE INDEX idx_subjects_curriculum ON subjects(curriculum_year, semester, year_level);

-- ============================================================
-- 4. SECTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS sections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_code TEXT NOT NULL,
  program      TEXT NOT NULL,
  year_level   TEXT NOT NULL,
  semester     TEXT NOT NULL,
  school_year  TEXT NOT NULL,
  UNIQUE(section_code, school_year, semester)
);

-- ============================================================
-- 5. SCHEDULES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  faculty_id   UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  day_of_week  TEXT NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  room         TEXT NOT NULL,
  school_year  TEXT NOT NULL,
  semester     TEXT NOT NULL,
  CHECK (end_time > start_time)
);

CREATE INDEX idx_schedules_subject ON schedules(subject_id);
CREATE INDEX idx_schedules_section ON schedules(section_id);
CREATE INDEX idx_schedules_faculty ON schedules(faculty_id);
CREATE INDEX idx_schedules_day ON schedules(day_of_week, start_time);

-- ============================================================
-- 6. ENROLLMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS enrollments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  school_year  TEXT NOT NULL,
  semester     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','dropped','withdrawn','completed','failed')),
  grade        NUMERIC(3,2) CHECK (grade IS NULL OR (grade >= 1.0 AND grade <= 5.0)),
  completion   TEXT CHECK (completion IN ('passed','failed','incomplete','dropped') OR completion IS NULL),
  enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject_id, school_year, semester)
);

CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_subject ON enrollments(subject_id);
CREATE INDEX idx_enrollments_semester ON enrollments(school_year, semester);

-- ============================================================
-- 7. ACADEMIC RECORDS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS academic_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_year       TEXT NOT NULL,
  semester          TEXT NOT NULL,
  gpa               NUMERIC(3,2) NOT NULL CHECK (gpa >= 1.0 AND gpa <= 5.0),
  total_units       INT NOT NULL CHECK (total_units >= 0),
  scholastic_status TEXT NOT NULL DEFAULT 'Regular',
  admission_status  TEXT NOT NULL DEFAULT 'Admitted',
  UNIQUE(student_id, school_year, semester)
);

CREATE INDEX idx_academic_records_student ON academic_records(student_id);

-- ============================================================
-- 8. CONCERNS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS concerns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN ('Academic','Facility','Personal','Financial','Technical','Harassment','Discrimination','Other')),
  subject_line    TEXT NOT NULL CHECK (char_length(subject_line) >= 5 AND char_length(subject_line) <= 200),
  body_text       TEXT NOT NULL CHECK (char_length(body_text) >= 20 AND char_length(body_text) <= 10000),
  ai_summary      TEXT,
  urgency_level   TEXT CHECK (urgency_level IN ('low','medium','high','critical') OR urgency_level IS NULL),
  suggested_dept  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','resolved','closed')),
  assigned_to     UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_concerns_student ON concerns(student_id);
CREATE INDEX idx_concerns_status ON concerns(status);
CREATE INDEX idx_concerns_urgency ON concerns(urgency_level);
CREATE INDEX idx_concerns_assigned ON concerns(assigned_to);
CREATE INDEX idx_concerns_created ON concerns(created_at DESC);

-- ============================================================
-- 9. CONCERN RESPONSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS concern_responses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  concern_id     UUID NOT NULL REFERENCES concerns(id) ON DELETE CASCADE,
  responder_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  response_text  TEXT NOT NULL CHECK (char_length(response_text) >= 1 AND char_length(response_text) <= 10000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_concern_responses_concern ON concern_responses(concern_id);
CREATE INDEX idx_concern_responses_created ON concern_responses(created_at);

-- ============================================================
-- 10. VIOLATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS violations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  recorded_by     UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  violation_type  TEXT NOT NULL,
  description     TEXT NOT NULL CHECK (char_length(description) >= 10),
  severity        TEXT NOT NULL CHECK (severity IN ('minor','major','grave')),
  sanction        TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','appealed','served','dismissed')),
  incident_date   DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_violations_student ON violations(student_id);
CREATE INDEX idx_violations_severity ON violations(severity);
CREATE INDEX idx_violations_status ON violations(status);

-- ============================================================
-- 11. STUDENT FILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS student_files (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  uploaded_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_category TEXT NOT NULL CHECK (file_category IN ('enrollment_form','clearance','medical_certificate','transcript','id_photo','requirement','other')),
  file_size     INT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760), -- 10MB max
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_student_files_student ON student_files(student_id);
CREATE INDEX idx_student_files_category ON student_files(file_category);

-- ============================================================
-- 12. MESSAGES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_line  TEXT NOT NULL CHECK (char_length(subject_line) >= 1 AND char_length(subject_line) <= 200),
  body_text     TEXT NOT NULL CHECK (char_length(body_text) >= 1 AND char_length(body_text) <= 10000),
  status        TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','read','archived')),
  folder        TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox','sent','drafts','trash')),
  is_batch      BOOLEAN NOT NULL DEFAULT FALSE,
  batch_filter  TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at       TIMESTAMPTZ
);

CREATE INDEX idx_messages_recipient ON messages(recipient_id, folder);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_sent ON messages(sent_at DESC);

-- ============================================================
-- 13. FACULTY EVALUATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS faculty_evaluations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  schedule_id  UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  ratings      JSONB NOT NULL DEFAULT '{}',
  comments     TEXT,
  school_year  TEXT NOT NULL,
  semester     TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ,
  UNIQUE(student_id, schedule_id)
);

CREATE INDEX idx_faculty_eval_student ON faculty_evaluations(student_id);
CREATE INDEX idx_faculty_eval_schedule ON faculty_evaluations(schedule_id);
CREATE INDEX idx_faculty_eval_semester ON faculty_evaluations(school_year, semester);

-- ============================================================
-- 14. GRADUATION APPLICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS graduation_applications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  month       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  checklist   JSONB NOT NULL DEFAULT '{}',
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graduation_student ON graduation_applications(student_id);
CREATE INDEX idx_graduation_status ON graduation_applications(status);

-- ============================================================
-- 15. AUDIT LOGS TABLE (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  resource    TEXT NOT NULL,
  details     TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ============================================================
-- 16. CALENDAR EVENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  description TEXT,
  event_type  TEXT NOT NULL CHECK (event_type IN ('academic','enrollment','holiday','deadline','event','other')),
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  created_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_calendar_dates ON calendar_events(start_date, end_date);
CREATE INDEX idx_calendar_type ON calendar_events(event_type);

-- ============================================================
-- TRIGGERS: Auto-update updated_at timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_concerns_updated_at
  BEFORE UPDATE ON concerns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY POLICIES
-- ============================================================

-- Helper function: get the user's role from JWT app_metadata.
-- Defined in public schema (auth schema is restricted by Supabase).
--
-- SECURITY NOTE: We read from app_metadata, NOT user_metadata.
-- - app_metadata: server-controlled. Only the service_role key can write.
-- - user_metadata: user-controlled. Any authenticated user can write via
--   supabase.auth.updateUser({ data: { role: 'admin' } }) — DANGEROUS.
-- Reading roles from user_metadata would let any user grant themselves admin.
CREATE OR REPLACE FUNCTION public.user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    (auth.jwt() ->> 'role'),
    'student'
  );
$$;

-- Allow authenticated users to call this function
GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated, anon;

-- ── STUDENTS ──
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own record"
  ON students FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Students can update own record"
  ON students FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Staff can view all students"
  ON students FOR SELECT
  USING (public.user_role() IN ('staff', 'admin'));

CREATE POLICY "Staff can update students"
  ON students FOR UPDATE
  USING (public.user_role() IN ('staff', 'admin'));

CREATE POLICY "Admin can insert students"
  ON students FOR INSERT
  WITH CHECK (public.user_role() = 'admin' OR user_id = auth.uid());

-- ── STAFF ──
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view own record"
  ON staff FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "All authenticated can view staff names"
  ON staff FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admin can manage staff"
  ON staff FOR ALL
  USING (public.user_role() = 'admin');

-- ── SUBJECTS ──
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view subjects"
  ON subjects FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage subjects"
  ON subjects FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── SECTIONS ──
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view sections"
  ON sections FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage sections"
  ON sections FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── SCHEDULES ──
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view schedules"
  ON schedules FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage schedules"
  ON schedules FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── ENROLLMENTS ──
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own enrollments"
  ON enrollments FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can view all enrollments"
  ON enrollments FOR SELECT
  USING (public.user_role() IN ('staff', 'admin'));

CREATE POLICY "Staff can manage enrollments"
  ON enrollments FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── ACADEMIC RECORDS ──
ALTER TABLE academic_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own academic records"
  ON academic_records FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can manage academic records"
  ON academic_records FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── CONCERNS ──
ALTER TABLE concerns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own concerns"
  ON concerns FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Students can insert own concerns"
  ON concerns FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can view all concerns"
  ON concerns FOR SELECT
  USING (public.user_role() IN ('staff', 'admin'));

CREATE POLICY "Staff can update concerns"
  ON concerns FOR UPDATE
  USING (public.user_role() IN ('staff', 'admin'));

-- ── CONCERN RESPONSES ──
ALTER TABLE concern_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view responses on their concerns"
  ON concern_responses FOR SELECT
  USING (
    concern_id IN (
      SELECT c.id FROM concerns c
      JOIN students s ON c.student_id = s.id
      WHERE s.user_id = auth.uid()
    )
    OR public.user_role() IN ('staff', 'admin')
  );

CREATE POLICY "Authenticated users can insert responses"
  ON concern_responses FOR INSERT
  WITH CHECK (responder_id = auth.uid());

-- ── VIOLATIONS ──
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own violations"
  ON violations FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can manage violations"
  ON violations FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── STUDENT FILES ──
ALTER TABLE student_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own files"
  ON student_files FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Students can upload own files"
  ON student_files FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "Staff can view all files"
  ON student_files FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── MESSAGES ──
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view received messages"
  ON messages FOR SELECT
  USING (recipient_id = auth.uid() OR sender_id = auth.uid());

CREATE POLICY "Users can send messages"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can update own messages (read status, folder)"
  ON messages FOR UPDATE
  USING (recipient_id = auth.uid() OR sender_id = auth.uid());

-- ── FACULTY EVALUATIONS ──
ALTER TABLE faculty_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view/manage own evaluations"
  ON faculty_evaluations FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Students can insert own evaluations"
  ON faculty_evaluations FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Students can update own evaluations"
  ON faculty_evaluations FOR UPDATE
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can view all evaluations"
  ON faculty_evaluations FOR SELECT
  USING (public.user_role() IN ('staff', 'admin'));

-- ── GRADUATION APPLICATIONS ──
ALTER TABLE graduation_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own graduation applications"
  ON graduation_applications FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Students can apply for graduation"
  ON graduation_applications FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "Staff can manage graduation applications"
  ON graduation_applications FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));

-- ── AUDIT LOGS (append-only) ──
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert audit logs"
  ON audit_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Staff can view audit logs"
  ON audit_logs FOR SELECT
  USING (public.user_role() IN ('staff', 'admin'));

-- No UPDATE or DELETE policies = truly append-only

-- ── CALENDAR EVENTS ──
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view calendar"
  ON calendar_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Staff can manage calendar"
  ON calendar_events FOR ALL
  USING (public.user_role() IN ('staff', 'admin'));
