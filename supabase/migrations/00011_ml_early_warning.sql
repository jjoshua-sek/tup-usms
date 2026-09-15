-- ============================================================
-- Migration 00011: Machine Learning Early Warning System
-- ============================================================
-- THE THESIS HEADLINE:
--   "Implementation of a Machine Learning-Based Early Warning System
--    for At-Risk Students"
--
-- PIPELINE
--   Student uploads COR / rating slip
--       → Claude Vision extracts structured academic data
--       → OSA staff verifies or corrects   ← human-in-the-loop gate
--       → academic_snapshots (trusted feature source)
--       → logistic regression inference
--       → risk_assessments (score + per-feature contributions)
--       → Claude writes the staff-facing narrative
--       → risk_interventions (what OSA actually does about it)
--
-- MODEL CHOICE RATIONALE (for the defense):
--   Logistic regression was selected over tree ensembles because each
--   coefficient IS the feature importance. When OSA asks "why is this
--   student flagged," the answer is a signed contribution per feature,
--   computed exactly, with no post-hoc approximation such as SHAP. For a
--   system that triggers interventions on real students, an auditable
--   linear model is more defensible than a marginally more accurate
--   opaque one.
--
--   Weights are trained OFFLINE (Python/scikit-learn on historical OSA
--   records) and imported into risk_model_versions. Inference runs in
--   TypeScript — no Python service in the request path.
-- ============================================================

-- ============================================================
-- 1. ACADEMIC DOCUMENTS — student-uploaded COR and rating slips
-- ============================================================
-- Replaces a live Registrar integration, which OSA cannot obtain.
-- The student already possesses these documents; uploading them is both
-- the data-acquisition mechanism and the RA 10173 consent event.
CREATE TABLE IF NOT EXISTS public.academic_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  document_type   TEXT NOT NULL CHECK (document_type IN (
    'certificate_of_registration',  -- issued at enrollment: units, subjects, schedule
    'rating_slip',                  -- issued end of term: grades, GWA
    'transcript'
  )),

  school_year     TEXT NOT NULL,
  semester        TEXT NOT NULL,

  file_path       TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  file_size       INT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),

  -- EXTRACTION PIPELINE STATE
  processing_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (processing_status IN (
    'uploaded',
    'extracting',        -- Claude Vision call in flight
    'extracted',         -- AI produced data; awaiting human verification
    'verification_failed',
    'verified',          -- staff confirmed; may now feed the model
    'rejected'           -- unreadable, wrong document, or suspected tampering
  )),

  -- Raw structured output from Claude Vision. Retained verbatim even after
  -- correction, so extraction accuracy can be measured for the thesis
  -- (compare extracted_data against the verified snapshot).
  extracted_data  JSONB,
  -- Model's self-reported confidence, 0–1. Low values route to priority review.
  extraction_confidence NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL
           OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  extraction_model TEXT,          -- e.g. 'claude-sonnet-4'
  extracted_at    TIMESTAMPTZ,
  extraction_error TEXT,

  -- HUMAN-IN-THE-LOOP GATE
  verified_by     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  verified_at     TIMESTAMPTZ,
  -- Staff's corrected version. When present this supersedes extracted_data.
  -- Diffing the two is how we report extraction accuracy.
  corrected_data  JSONB,
  verification_notes TEXT,
  rejection_reason TEXT,

  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, document_type, school_year, semester)
);

CREATE INDEX IF NOT EXISTS idx_acadocs_student
  ON public.academic_documents(student_id, school_year, semester);
CREATE INDEX IF NOT EXISTS idx_acadocs_status
  ON public.academic_documents(processing_status);
-- The staff verification queue, ordered oldest-first.
CREATE INDEX IF NOT EXISTS idx_acadocs_pending_verification
  ON public.academic_documents(uploaded_at)
  WHERE processing_status = 'extracted';
-- Low-confidence extractions get reviewed first.
CREATE INDEX IF NOT EXISTS idx_acadocs_low_confidence
  ON public.academic_documents(extraction_confidence)
  WHERE processing_status = 'extracted' AND extraction_confidence < 0.80;

-- ============================================================
-- 2. ACADEMIC SNAPSHOTS — the trusted ML feature source
-- ============================================================
-- One row per student per term. Populated only from VERIFIED documents,
-- or entered manually by staff. Never written directly by AI.
CREATE TABLE IF NOT EXISTS public.academic_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  school_year     TEXT NOT NULL,
  semester        TEXT NOT NULL,
  -- Monotonic ordering key, so "previous term" is a simple comparison
  -- rather than parsing year + semester strings.
  term_sequence   INT NOT NULL,

  -- Philippine grading convention: 1.00 is the highest mark, 5.00 fails.
  -- Every downstream calculation must respect that inversion.
  gwa             NUMERIC(3,2)
    CHECK (gwa IS NULL OR (gwa >= 1.00 AND gwa <= 5.00)),

  units_enrolled  INT CHECK (units_enrolled IS NULL OR units_enrolled >= 0),
  units_passed    INT CHECK (units_passed IS NULL OR units_passed >= 0),
  units_failed    INT CHECK (units_failed IS NULL OR units_failed >= 0),
  units_dropped   INT CHECK (units_dropped IS NULL OR units_dropped >= 0),

  subjects_enrolled INT,
  subjects_failed   INT,

  -- 0–1. Not present on a rating slip; captured by faculty referral or
  -- self-report. Nullable, and the model handles its absence.
  attendance_rate NUMERIC(4,3)
    CHECK (attendance_rate IS NULL
           OR (attendance_rate >= 0 AND attendance_rate <= 1)),

  scholastic_status TEXT CHECK (scholastic_status IN (
    'Regular', 'Probationary', 'Warning', 'Dismissed', 'Graduating'
  ) OR scholastic_status IS NULL),

  -- Per-subject detail preserved from the rating slip, for drill-down.
  subject_grades  JSONB,

  -- Provenance: which upload produced this row, and how much to trust it.
  source_document_id UUID REFERENCES public.academic_documents(id) ON DELETE SET NULL,
  data_source     TEXT NOT NULL DEFAULT 'document_extraction' CHECK (data_source IN (
    'document_extraction',  -- AI-extracted then staff-verified
    'manual_entry',         -- typed by staff
    'registrar_import'      -- reserved for a future bulk import
  )),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, school_year, semester),
  CHECK (units_passed IS NULL OR units_enrolled IS NULL
         OR units_passed <= units_enrolled)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_student
  ON public.academic_snapshots(student_id, term_sequence DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_term
  ON public.academic_snapshots(school_year, semester);

DROP TRIGGER IF EXISTS trg_snapshots_updated_at ON public.academic_snapshots;
CREATE TRIGGER trg_snapshots_updated_at
  BEFORE UPDATE ON public.academic_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3. RISK MODEL VERSIONS — trained coefficients
-- ============================================================
-- Versioning the model is what lets the thesis show iteration: v1 baseline
-- from literature priors, v2 trained on institutional data, and a
-- measurable improvement between them. Every risk_assessment records which
-- version produced it, so historical scores stay interpretable.
CREATE TABLE IF NOT EXISTS public.risk_model_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_label   TEXT NOT NULL UNIQUE,

  algorithm       TEXT NOT NULL DEFAULT 'logistic_regression'
    CHECK (algorithm IN ('logistic_regression', 'gradient_boosting',
                         'random_forest', 'rule_based')),

  -- feature_key → weight. Sign carries meaning: positive increases risk.
  coefficients    JSONB NOT NULL,
  intercept       NUMERIC(10,6) NOT NULL DEFAULT 0,

  -- Score cut points. Probabilities, not raw logits.
  threshold_moderate NUMERIC(4,3) NOT NULL DEFAULT 0.350,
  threshold_high     NUMERIC(4,3) NOT NULL DEFAULT 0.600,
  threshold_critical NUMERIC(4,3) NOT NULL DEFAULT 0.800,

  -- Normalization constants captured at training time. Applying the model
  -- with different scaling than it was trained under silently corrupts
  -- predictions, so they travel with the weights.
  feature_scaling JSONB,

  -- Provenance + evaluation metrics, reported in the thesis.
  training_notes  TEXT,
  trained_on_records INT,
  training_date   DATE,
  -- { accuracy, precision, recall, f1, auc_roc, confusion_matrix }
  performance_metrics JSONB,

  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (threshold_moderate < threshold_high),
  CHECK (threshold_high < threshold_critical)
);

-- Exactly one active model at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_single_active
  ON public.risk_model_versions((is_active)) WHERE is_active;

-- ============================================================
-- 4. RISK ASSESSMENTS — model output per student
-- ============================================================
CREATE TABLE IF NOT EXISTS public.risk_assessments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  model_version_id UUID NOT NULL
    REFERENCES public.risk_model_versions(id) ON DELETE RESTRICT,

  -- Sigmoid output, 0–1.
  risk_score      NUMERIC(5,4) NOT NULL
    CHECK (risk_score >= 0 AND risk_score <= 1),

  risk_tier       TEXT NOT NULL CHECK (risk_tier IN (
    'low', 'moderate', 'high', 'critical'
  )),

  -- EXPLAINABILITY — the reason logistic regression was chosen.
  -- feature_values:        raw + normalized inputs
  -- feature_contributions: weight × normalized_value per feature, signed.
  --                        These sum with the intercept to the logit.
  feature_values  JSONB NOT NULL,
  feature_contributions JSONB NOT NULL,
  -- Top drivers, pre-sorted by |contribution| for direct UI rendering.
  top_risk_factors JSONB NOT NULL DEFAULT '[]',
  -- Features that pushed risk DOWN — shown so staff see the full picture
  -- rather than only the negatives when they meet the student.
  protective_factors JSONB NOT NULL DEFAULT '[]',

  -- Claude turns the contribution vector into prose for OSA staff.
  -- Generated from the numbers; it does not influence them.
  ai_narrative    TEXT,
  ai_recommended_actions JSONB,
  narrative_generated_at TIMESTAMPTZ,

  -- Completeness of the inputs. A 0.4-completeness assessment is shown
  -- with a caveat, because a student missing rating slips looks
  -- artificially low-risk.
  data_completeness NUMERIC(4,3)
    CHECK (data_completeness IS NULL
           OR (data_completeness >= 0 AND data_completeness <= 1)),

  -- Only one current assessment per student; prior ones are retained
  -- with is_current = FALSE to form a risk trajectory over time.
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,

  -- What triggered this run.
  trigger_reason  TEXT CHECK (trigger_reason IN (
    'scheduled_batch', 'document_verified', 'case_filed', 'case_closed',
    'manual_request', 'profile_updated', 'model_retrained'
  ) OR trigger_reason IS NULL),

  -- HUMAN OVERRIDE. Staff who know a student's context may disagree with
  -- the model. The override never rewrites risk_score — it sits beside it,
  -- so model performance can still be evaluated honestly afterward.
  staff_override_tier TEXT CHECK (staff_override_tier IN (
    'low', 'moderate', 'high', 'critical'
  ) OR staff_override_tier IS NULL),
  staff_override_reason TEXT,
  staff_override_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  staff_override_at   TIMESTAMPTZ,

  assessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_student
  ON public.risk_assessments(student_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_current
  ON public.risk_assessments(risk_tier, risk_score DESC) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_risk_high_tier
  ON public.risk_assessments(assessed_at DESC)
  WHERE is_current AND risk_tier IN ('high', 'critical');

-- Keep is_current honest: inserting a new assessment demotes the previous.
CREATE OR REPLACE FUNCTION public.demote_prior_risk_assessments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.risk_assessments
    SET is_current = FALSE
    WHERE student_id = NEW.student_id
      AND id <> NEW.id
      AND is_current;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demote_risk ON public.risk_assessments;
CREATE TRIGGER trg_demote_risk
  AFTER INSERT ON public.risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public.demote_prior_risk_assessments();

-- ============================================================
-- 5. RISK INTERVENTIONS — what OSA does about a flagged student
-- ============================================================
-- Without this table the system only produces a number. Interventions are
-- what convert a prediction into an action, and tracking their outcome is
-- what eventually lets the model be evaluated against reality.
CREATE TABLE IF NOT EXISTS public.risk_interventions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  risk_assessment_id UUID REFERENCES public.risk_assessments(id) ON DELETE SET NULL,

  intervention_type TEXT NOT NULL CHECK (intervention_type IN (
    'guidance_referral',
    'academic_advising',
    'financial_aid_referral',   -- route to the scholarship module
    'peer_mentoring',
    'parent_conference',
    'wellness_check',
    'tutoring_referral',
    'workload_adjustment',
    'disciplinary_followup',
    'other'
  )),

  -- Why this student, in the staff member's words. Distinct from the AI
  -- narrative: this is the human's justification for acting.
  rationale       TEXT,

  status          TEXT NOT NULL DEFAULT 'recommended' CHECK (status IN (
    'recommended',   -- system or staff proposed it
    'approved',
    'scheduled',
    'in_progress',
    'completed',
    'declined',      -- student declined
    'cancelled'
  )),

  priority        TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  assigned_to     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  scheduled_for   TIMESTAMPTZ,

  notes           TEXT,
  outcome         TEXT,
  -- Staff judgment on whether it helped. The honest signal for evaluating
  -- whether the early-warning system is actually working.
  outcome_rating  TEXT CHECK (outcome_rating IN (
    'improved', 'no_change', 'worsened', 'inconclusive'
  ) OR outcome_rating IS NULL),

  completed_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventions_student
  ON public.risk_interventions(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interventions_assigned
  ON public.risk_interventions(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_interventions_open
  ON public.risk_interventions(priority, scheduled_for)
  WHERE status IN ('recommended', 'approved', 'scheduled', 'in_progress');

DROP TRIGGER IF EXISTS trg_interventions_updated_at ON public.risk_interventions;
CREATE TRIGGER trg_interventions_updated_at
  BEFORE UPDATE ON public.risk_interventions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 6. FEATURE EXTRACTION VIEW
-- ============================================================
-- Assembles every model input for a student in one query. The TypeScript
-- scorer reads from here, so the feature definition lives in exactly one
-- place and cannot drift between training and inference.
--
-- Deliberately a VIEW rather than a materialized view: the underlying
-- volume is small (thousands of students) and staleness on a risk score
-- is worse than a few milliseconds of recomputation.
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
  latest.attendance_rate    AS current_attendance_rate,
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
  -- How many of the four core signals are present. Drives the caveat shown
  -- alongside a score computed from partial data.
  (
    (CASE WHEN latest.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN prev.gwa IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latest.attendance_rate IS NOT NULL THEN 1 ELSE 0 END) +
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

-- ============================================================
-- 7. SEED: baseline model (v1.0)
-- ============================================================
-- Coefficients are LITERATURE PRIORS, not institutionally trained. They
-- reflect the consistent finding across student-retention research that
-- academic performance and its trajectory dominate, followed by
-- attendance, then behavioral and socioeconomic factors.
--
-- This version exists so the system is functional from day one and so the
-- thesis has a documented baseline to improve upon. Replace with a trained
-- v2.0 once historical OSA outcomes are available.
INSERT INTO public.risk_model_versions (
  version_label, algorithm, coefficients, intercept,
  threshold_moderate, threshold_high, threshold_critical,
  feature_scaling, training_notes, trained_on_records, training_date,
  performance_metrics, is_active
) VALUES (
  'v1.0-baseline',
  'logistic_regression',
  jsonb_build_object(
    'gwa_risk',            2.80,  -- normalized GWA; strongest single predictor
    'gwa_delta',           1.90,  -- term-over-term decline
    'failure_ratio',       2.40,  -- proportion of units failed
    'attendance_deficit',  2.10,  -- 1 - attendance_rate
    'violation_severity',  1.60,  -- recency-weighted disciplinary load
    'open_cases',          0.70,  -- unresolved case count
    'financial_stress',    0.90,  -- Listahanan / self-supporting / working
    'probationary',        1.40   -- scholastic status flag
  ),
  -3.20,
  0.350, 0.600, 0.800,
  jsonb_build_object(
    'gwa_risk',           jsonb_build_object('method','minmax','min',1.0,'max',5.0,'invert',false),
    'gwa_delta',          jsonb_build_object('method','clamp','min',-1.0,'max',1.0),
    'failure_ratio',      jsonb_build_object('method','identity','min',0,'max',1),
    'attendance_deficit', jsonb_build_object('method','identity','min',0,'max',1),
    'violation_severity', jsonb_build_object('method','saturating','scale',10.0),
    'open_cases',         jsonb_build_object('method','saturating','scale',3.0)
  ),
  'Baseline model. Coefficients derived from student-retention literature priors, NOT trained on TUP institutional data. Serves as the v1 reference point. Retrain on historical OSA outcome data and promote as v2.0 before reporting predictive performance.',
  0,
  CURRENT_DATE,
  jsonb_build_object(
    'status', 'untrained_baseline',
    'note',   'No performance metrics: this version has not been evaluated against labeled outcomes.'
  ),
  TRUE
)
ON CONFLICT (version_label) DO NOTHING;
