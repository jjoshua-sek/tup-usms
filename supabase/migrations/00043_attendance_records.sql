-- ============================================================
-- 00043 — Attendance imported from the colleges or the Registrar
-- ============================================================
-- OSA checklist E2. Most of the team said the OSA has no attendance data;
-- the OSA's former student-body partner said it comes from faculty and the
-- colleges, and from the Registrar. The early-warning model already weighs
-- attendance (attendance_deficit), but nothing ever filled it, so every
-- score assumed a neutral value. The OSA now imports a CSV each term.
--
-- Attendance gets its own table rather than academic_snapshots: the view
-- below takes a student's GWA from their LATEST snapshot, and attendance
-- arrives for the current term while the latest verified rating slip is
-- usually the previous term's. An attendance-only snapshot for this term
-- would become "latest" and blank the GWA the model relies on.
--
-- One record per student per term; a later import replaces it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  school_year     TEXT NOT NULL,
  semester        TEXT NOT NULL,
  term_sequence   INT NOT NULL,
  -- From the file: sessions and absences when given, else the rate alone.
  sessions_held   INT CHECK (sessions_held IS NULL OR sessions_held > 0),
  sessions_absent INT CHECK (sessions_absent IS NULL OR sessions_absent >= 0),
  attendance_rate NUMERIC(4,3) NOT NULL CHECK (attendance_rate >= 0 AND attendance_rate <= 1),
  -- Who sent the file, e.g. "COS Dean's Office" or "Registrar".
  source          TEXT NOT NULL CHECK (char_length(source) BETWEEN 2 AND 120),
  batch_id        UUID,
  imported_by     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, school_year, semester),
  CHECK (sessions_absent IS NULL OR sessions_held IS NULL OR sessions_absent <= sessions_held)
);

CREATE INDEX IF NOT EXISTS idx_attendance_student ON public.attendance_records (student_id, term_sequence DESC);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own attendance" ON public.attendance_records;
CREATE POLICY "student reads own attendance" ON public.attendance_records
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "osa manages attendance" ON public.attendance_records;
CREATE POLICY "osa manages attendance" ON public.attendance_records
  FOR ALL USING (public.is_osa_staff()) WITH CHECK (public.is_osa_staff());

REVOKE ALL ON public.attendance_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;

-- The model's inputs, as in 00011, except that attendance now comes from
-- the latest imported record (falling back to a snapshot's own value).
CREATE OR REPLACE VIEW public.student_risk_features AS
SELECT
  s.id AS student_id,
  s.student_number,
  s.first_name,
  s.last_name,
  s.program,
  s.year_level,
  s.scholastic_status,

  -- ---- ACADEMIC (latest verified term) ----
  latest.gwa                AS current_gwa,
  latest.units_enrolled     AS current_units_enrolled,
  latest.units_failed       AS current_units_failed,
  COALESCE(att.attendance_rate, latest.attendance_rate)::NUMERIC(4,3) AS current_attendance_rate,
  latest.term_sequence      AS latest_term_sequence,

  -- ---- TREND (previous term, for delta) ----
  prev.gwa                  AS previous_gwa,
  -- Positive delta = GWA number went UP = performance DECLINED,
  -- because 1.0 is the best mark in the Philippine scale.
  (latest.gwa - prev.gwa)   AS gwa_delta,

  -- Failure ratio, guarded against divide-by-zero
  CASE
    WHEN latest.units_enrolled IS NULL OR latest.units_enrolled = 0 THEN NULL
    ELSE latest.units_failed::NUMERIC / latest.units_enrolled::NUMERIC
  END AS failure_ratio,

  -- ---- DISCIPLINARY ----
  COALESCE(v.minor_count, 0)  AS minor_violation_count,
  COALESCE(v.major_count, 0)  AS major_violation_count,
  COALESCE(v.open_count, 0)   AS open_case_count,
  v.days_since_last_violation,

  -- ---- SOCIOECONOMIC ----
  s.is_listahan,
  s.is_pwd,
  s.is_indigenous,
  s.financial_support,

  -- ---- COMPLETENESS ----
  (
    (CASE WHEN latest.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN prev.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(att.attendance_rate, latest.attendance_rate) IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.units_enrolled IS NOT NULL THEN 1 ELSE 0 END)
  )::NUMERIC / 4.0 AS data_completeness

FROM public.students s

-- Most recent academic snapshot
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id
  ORDER BY a.term_sequence DESC
  LIMIT 1
) latest ON TRUE

-- The term before that
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id
    AND a.term_sequence < COALESCE(latest.term_sequence, 2147483647)
  ORDER BY a.term_sequence DESC
  LIMIT 1
) prev ON TRUE

-- Most recent imported attendance
LEFT JOIN LATERAL (
  SELECT r.attendance_rate FROM public.attendance_records r
  WHERE r.student_id = s.id
  ORDER BY r.term_sequence DESC
  LIMIT 1
) att ON TRUE

-- Disciplinary aggregates
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE classification = 'minor') AS minor_count,
    COUNT(*) FILTER (WHERE classification = 'major') AS major_count,
    COUNT(*) FILTER (WHERE status NOT IN ('closed','dismissed')) AS open_count,
    MIN(NOW()::DATE - incident_date) AS days_since_last_violation
  FROM public.violation_cases c
  WHERE c.student_id = s.id
    -- Confidential cases are excluded from risk features on purpose:
    -- including them would let a risk score leak the existence of a CODI
    -- matter to staff who are not cleared to know about it.
    AND c.confidentiality <> 'codi'
) v ON TRUE;
