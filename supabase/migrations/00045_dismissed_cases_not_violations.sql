-- ============================================================
-- 00045 — A dismissed case is not a violation
-- ============================================================
-- student_risk_features counted every minor and major case, dismissed ones
-- included, so a complaint the OSA found unsubstantiated still raised the
-- student's risk score and counted toward the time since their last
-- violation. Found on 2026-10-22 while testing scholar monitoring, which
-- had the same fault (fixed in the app). Only the disciplinary aggregates
-- change; everything else is as in 00044.
-- ============================================================

CREATE OR REPLACE VIEW public.student_risk_features AS
SELECT
  s.id AS student_id,
  s.student_number,
  s.first_name,
  s.last_name,
  s.program,
  s.year_level,
  s.scholastic_status,

  -- ---- ACADEMIC ----
  graded.gwa                AS current_gwa,
  COALESCE(loaded.units_enrolled, graded.units_enrolled) AS current_units_enrolled,
  graded.units_failed       AS current_units_failed,
  COALESCE(att.attendance_rate, latest.attendance_rate)::NUMERIC(4,3) AS current_attendance_rate,
  latest.term_sequence      AS latest_term_sequence,

  -- ---- TREND (the graded term before, for delta) ----
  prev.gwa                  AS previous_gwa,
  -- Positive delta = GWA number went UP = performance DECLINED,
  -- because 1.0 is the best mark in the Philippine scale.
  (graded.gwa - prev.gwa)   AS gwa_delta,

  -- Failure ratio from the rating slip's own term, guarded against divide-by-zero
  CASE
    WHEN graded.units_enrolled IS NULL OR graded.units_enrolled = 0 OR graded.units_failed IS NULL THEN NULL
    ELSE graded.units_failed::NUMERIC / graded.units_enrolled::NUMERIC
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
    (CASE WHEN graded.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN prev.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(att.attendance_rate, latest.attendance_rate) IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(loaded.units_enrolled, graded.units_enrolled) IS NOT NULL THEN 1 ELSE 0 END)
  )::NUMERIC / 4.0 AS data_completeness

FROM public.students s

-- Most recent snapshot of any kind
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id
  ORDER BY a.term_sequence DESC
  LIMIT 1
) latest ON TRUE

-- Most recent snapshot with a GWA (a verified rating slip)
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id AND a.gwa IS NOT NULL
  ORDER BY a.term_sequence DESC
  LIMIT 1
) graded ON TRUE

-- The graded term before that
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id
    AND a.gwa IS NOT NULL
    AND a.term_sequence < COALESCE(graded.term_sequence, 2147483647)
  ORDER BY a.term_sequence DESC
  LIMIT 1
) prev ON TRUE

-- Most recent snapshot with units enrolled (this term's COR, usually)
LEFT JOIN LATERAL (
  SELECT * FROM public.academic_snapshots a
  WHERE a.student_id = s.id AND a.units_enrolled IS NOT NULL
  ORDER BY a.term_sequence DESC
  LIMIT 1
) loaded ON TRUE

-- Most recent imported attendance (00043)
LEFT JOIN LATERAL (
  SELECT r.attendance_rate FROM public.attendance_records r
  WHERE r.student_id = s.id
  ORDER BY r.term_sequence DESC
  LIMIT 1
) att ON TRUE

-- Disciplinary aggregates
LEFT JOIN LATERAL (
  SELECT
    -- A dismissed complaint was not substantiated: not a violation on record.
    COUNT(*) FILTER (WHERE classification = 'minor' AND status <> 'dismissed') AS minor_count,
    COUNT(*) FILTER (WHERE classification = 'major' AND status <> 'dismissed') AS major_count,
    COUNT(*) FILTER (WHERE status NOT IN ('closed','dismissed')) AS open_count,
    MIN(NOW()::DATE - incident_date) FILTER (WHERE status <> 'dismissed') AS days_since_last_violation
  FROM public.violation_cases c
  WHERE c.student_id = s.id
    -- Confidential cases are excluded from risk features on purpose:
    -- including them would let a risk score leak the existence of a CODI
    -- matter to staff who are not cleared to know about it.
    AND c.confidentiality <> 'codi'
) v ON TRUE;
