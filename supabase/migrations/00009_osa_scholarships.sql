-- ============================================================
-- Migration 00009: Scholarship Management & Eligibility
-- ============================================================
-- Implements OSA process §2.2 and flowchart §3.3, plus requirement #3:
-- tell a student which scholarships they are eligible for and what
-- documents each one needs.
--
-- KEY SCOPE BOUNDARY (stated explicitly in requirement #3): the system
-- does NOT submit applications on a student's behalf. It answers
-- "where am I eligible, and what do I need to bring?" Actual application
-- and endorsement remain OSA-mediated, matching the real process where
-- OSA collects forms and issues recommendations.
--
-- TWO FUNDING TRACKS from the OSA document:
--   GOVERNMENT (TTF, Tulong Dunong, CHED) — beneficiary masterlists are
--     supplied by the agency; OSA validates and endorses.
--   PRIVATE (~19 sponsors) — criteria are dictated by each MOA/MOU, so
--     the criteria model must be generic enough to express any sponsor's
--     rules without schema changes per sponsor.
--
-- The criteria engine is therefore data-driven: each rule is a row, not
-- a hardcoded branch. Adding a 20th sponsor is an INSERT, not a deploy.
-- ============================================================

-- ============================================================
-- 1. SCHOLARSHIPS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scholarships (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  sponsor_name      TEXT NOT NULL,

  funding_type      TEXT NOT NULL CHECK (funding_type IN (
    'government',     -- TTF, Tulong Dunong, CHED programs
    'private',        -- MOA/MOU-governed sponsors
    'institutional'   -- TUP-funded
  )),

  description       TEXT,
  benefit_summary   TEXT,  -- "Full tuition + ₱5,000/sem stipend"

  -- Government programs supply a masterlist rather than accepting open
  -- applications. This flag changes the student-facing copy from
  -- "You may apply" to "Check if you are on the masterlist."
  is_masterlist_based BOOLEAN NOT NULL DEFAULT FALSE,

  slots_available   INT,
  slots_filled      INT NOT NULL DEFAULT 0,

  application_opens  DATE,
  application_closes DATE,

  -- Reference to the governing agreement, so staff can cite the source
  -- of a requirement when a student disputes it.
  moa_reference     TEXT,
  contact_person    TEXT,
  contact_email     TEXT,
  external_url      TEXT,

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (application_closes IS NULL OR application_opens IS NULL
         OR application_closes >= application_opens),
  CHECK (slots_available IS NULL OR slots_filled <= slots_available)
);

CREATE INDEX IF NOT EXISTS idx_scholarships_type
  ON public.scholarships(funding_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_scholarships_window
  ON public.scholarships(application_opens, application_closes) WHERE is_active;

DROP TRIGGER IF EXISTS trg_scholarships_updated_at ON public.scholarships;
CREATE TRIGGER trg_scholarships_updated_at
  BEFORE UPDATE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. SCHOLARSHIP CRITERIA — the rule engine
-- ============================================================
-- Each row is one testable condition. The evaluator
-- (src/lib/scholarships/evaluate-eligibility.ts) reads these rows and
-- applies them against a student profile.
--
-- criterion_key names a field the evaluator knows how to resolve; operator
-- names a comparison; value holds the threshold. This triple can express
-- every requirement pattern found across TUP's sponsor agreements.
CREATE TABLE IF NOT EXISTS public.scholarship_criteria (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scholarship_id  UUID NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,

  criterion_key   TEXT NOT NULL CHECK (criterion_key IN (
    -- Academic (from verified rating slips / COR)
    'gpa',                  -- Philippine scale: LOWER is better (1.0 best, 5.0 fail)
    'units_enrolled',
    'year_level',
    'program',
    'department',
    'scholastic_status',
    'no_failing_grades',
    -- Conduct (from violation_cases)
    'no_major_violations',
    'no_pending_cases',
    'max_minor_violations',
    -- Socioeconomic (from the student profile)
    'family_income_bracket',
    'is_listahan',
    'is_indigenous',
    'is_pwd',
    'financial_support',
    -- Other
    'is_graduating',
    'residency_province',
    'has_no_other_scholarship'
  )),

  operator        TEXT NOT NULL CHECK (operator IN (
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'not_in', 'is_true', 'is_false'
  )),

  -- JSONB so a single column holds numbers, strings, and arrays uniformly.
  value           JSONB NOT NULL,

  -- Mandatory criteria disqualify when failed. Non-mandatory ones are
  -- "preferred" — a student still sees the scholarship, flagged as a
  -- partial match, because sponsors often waive preferences in practice.
  is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,

  -- Shown verbatim in the student UI. Written in plain language because
  -- the audience is a student deciding whether to pursue an application.
  human_description TEXT NOT NULL,

  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_criteria_scholarship
  ON public.scholarship_criteria(scholarship_id, display_order);

-- ============================================================
-- 3. SCHOLARSHIP REQUIREMENTS — the document checklist
-- ============================================================
-- Distinct from criteria: criteria decide *whether you qualify*,
-- requirements list *what you must submit*. A student can be eligible
-- and still be missing paperwork.
CREATE TABLE IF NOT EXISTS public.scholarship_requirements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scholarship_id  UUID NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,
  requirement_name TEXT NOT NULL,
  description     TEXT,
  document_type   TEXT CHECK (document_type IN (
    'form', 'certificate', 'transcript', 'id_copy', 'income_proof',
    'recommendation_letter', 'essay', 'photo', 'medical', 'other'
  ) OR document_type IS NULL),
  is_mandatory    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Where the student obtains it, e.g. "Registrar's Office, 2nd floor"
  obtained_from   TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requirements_scholarship
  ON public.scholarship_requirements(scholarship_id, display_order);

-- ============================================================
-- 4. ELIGIBILITY RESULTS — cached evaluation output
-- ============================================================
-- Recomputed when a student's underlying data changes (new rating slip
-- verified, violation case closed, profile updated). Cached rather than
-- computed per page load because the student dashboard shows eligibility
-- across every active scholarship at once.
CREATE TABLE IF NOT EXISTS public.scholarship_eligibility_results (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  scholarship_id  UUID NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,

  -- 'eligible'        = all mandatory criteria pass
  -- 'partially_eligible' = mandatory pass, some preferences fail
  -- 'not_eligible'    = at least one mandatory criterion fails
  -- 'indeterminate'   = missing data (e.g. no verified rating slip yet)
  eligibility_status TEXT NOT NULL CHECK (eligibility_status IN (
    'eligible', 'partially_eligible', 'not_eligible', 'indeterminate'
  )),

  -- Arrays of { criterion_key, human_description, expected, actual }
  passed_criteria JSONB NOT NULL DEFAULT '[]',
  failed_criteria JSONB NOT NULL DEFAULT '[]',
  -- Criteria that could not be evaluated for lack of data. Drives the
  -- "upload your rating slip to see if you qualify" prompt.
  missing_data    JSONB NOT NULL DEFAULT '[]',

  match_percentage NUMERIC(5,2),

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, scholarship_id)
);

CREATE INDEX IF NOT EXISTS idx_eligibility_student
  ON public.scholarship_eligibility_results(student_id, eligibility_status);
CREATE INDEX IF NOT EXISTS idx_eligibility_eligible
  ON public.scholarship_eligibility_results(student_id)
  WHERE eligibility_status IN ('eligible', 'partially_eligible');

-- ============================================================
-- 5. APPLICATIONS — OSA's collection + endorsement record
-- ============================================================
-- Mirrors flowchart §3.3: OSA collects forms → validates eligibility →
-- issues recommendation and endorsement → forwards to funding agency.
CREATE TABLE IF NOT EXISTS public.scholarship_applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  scholarship_id  UUID NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,

  status          TEXT NOT NULL DEFAULT 'interest_declared' CHECK (status IN (
    'interest_declared',   -- student flagged intent in the portal
    'documents_pending',   -- OSA is waiting on requirements
    'documents_complete',
    'under_review',        -- OSA validating eligibility
    'endorsed',            -- OSA recommendation issued
    'forwarded',           -- sent to the funding agency
    'awarded',
    'rejected',
    'withdrawn'
  )),

  school_year     TEXT NOT NULL,
  semester        TEXT,

  -- Snapshot of the eligibility evaluation at the time of application, so
  -- a later data change does not retroactively alter the record OSA relied on.
  eligibility_snapshot JSONB,

  -- Requirement checklist progress: [{ requirement_id, submitted, verified }]
  requirements_status JSONB NOT NULL DEFAULT '[]',

  endorsed_by     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  endorsed_at     TIMESTAMPTZ,
  endorsement_notes TEXT,

  rejection_reason TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, scholarship_id, school_year, semester)
);

CREATE INDEX IF NOT EXISTS idx_applications_student
  ON public.scholarship_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_scholarship
  ON public.scholarship_applications(scholarship_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_pending
  ON public.scholarship_applications(created_at DESC)
  WHERE status IN ('documents_pending', 'documents_complete', 'under_review');

DROP TRIGGER IF EXISTS trg_applications_updated_at ON public.scholarship_applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON public.scholarship_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 6. MASTERLIST ENTRIES — government beneficiary rosters
-- ============================================================
-- Government programs push a list of already-selected beneficiaries.
-- OSA imports it; the system then matches entries to student records so a
-- student can see "you are on the TTF masterlist" without OSA doing a
-- manual lookup.
CREATE TABLE IF NOT EXISTS public.scholarship_masterlist_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scholarship_id  UUID NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,

  -- Raw identifiers as they appear in the agency file. Kept even after
  -- matching so an unmatched row can be investigated.
  student_number  TEXT NOT NULL,
  full_name_raw   TEXT,

  -- Resolved link. NULL when the agency roster contains a student number
  -- that does not exist in our records (transferee, typo, etc.).
  student_id      UUID REFERENCES public.students(id) ON DELETE SET NULL,
  match_status    TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('matched', 'unmatched', 'ambiguous', 'manual_override')),

  school_year     TEXT NOT NULL,
  semester        TEXT,
  award_amount    NUMERIC(12,2),

  imported_by     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_file     TEXT,

  UNIQUE (scholarship_id, student_number, school_year, semester)
);

CREATE INDEX IF NOT EXISTS idx_masterlist_student
  ON public.scholarship_masterlist_entries(student_id)
  WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_masterlist_number
  ON public.scholarship_masterlist_entries(student_number);
CREATE INDEX IF NOT EXISTS idx_masterlist_unmatched
  ON public.scholarship_masterlist_entries(scholarship_id)
  WHERE match_status = 'unmatched';

-- ============================================================
-- 7. SEED: representative scholarships
-- ============================================================
-- Government programs named in the OSA document, plus two private
-- examples demonstrating MOA-driven criteria. Real sponsor data should
-- replace these once OSA supplies the actual agreements.
INSERT INTO public.scholarships
  (code, name, sponsor_name, funding_type, description, benefit_summary,
   is_masterlist_based, moa_reference, is_active)
VALUES
  ('TTF', 'Tertiary Education Subsidy (TES)',
   'Unified Student Financial Assistance System for Tertiary Education (UniFAST)',
   'government',
   'Government subsidy for tertiary students, prioritizing those in the Listahanan household registry.',
   'Tuition subsidy + allowance per academic year',
   TRUE, 'RA 10931 (Universal Access to Quality Tertiary Education Act)', TRUE),

  ('TDP', 'Tulong Dunong Program',
   'Commission on Higher Education (CHED)',
   'government',
   'CHED financial assistance program for qualified students in state universities.',
   'Financial assistance per semester',
   TRUE, 'CHED Memorandum Order', TRUE),

  ('CHED-SGP', 'CHED Student Grants-in-Aid Program (SGP-PA)',
   'Commission on Higher Education (CHED)',
   'government',
   'Grants-in-aid for poverty alleviation, targeting the poorest households.',
   'Full tuition + stipend',
   TRUE, 'CHED SGP-PA Guidelines', TRUE),

  ('PRIV-ACAD', 'Academic Excellence Scholarship',
   'TUP Alumni Association',
   'private',
   'Merit-based scholarship for students maintaining strong academic standing with a clean disciplinary record.',
   'Partial tuition + book allowance',
   FALSE, 'MOA-2024-ALUM-01', TRUE),

  ('PRIV-ENG', 'Engineering Futures Grant',
   'Partner Industry Foundation',
   'private',
   'Industry-sponsored grant for engineering and technology students in their upper years.',
   'Tuition + monthly stipend + internship placement',
   FALSE, 'MOU-2025-IND-07', TRUE),

  ('INST-WORK', 'Student Assistantship Program',
   'TUP Office of Student Affairs',
   'institutional',
   'Work-study program placing students in campus offices in exchange for tuition credit.',
   'Tuition credit + hourly stipend',
   FALSE, NULL, TRUE)
ON CONFLICT (code) DO NOTHING;

-- ---- Criteria for the merit-based private scholarship ----
-- Demonstrates the rule engine. NOTE the Philippine GPA convention:
-- 1.0 is the highest mark and 5.0 is failing, so "GPA at least 1.75"
-- is expressed as gpa <= 1.75 (lte), not gte.
INSERT INTO public.scholarship_criteria
  (scholarship_id, criterion_key, operator, value, is_mandatory, human_description, display_order)
SELECT s.id, c.criterion_key, c.operator, c.value, c.is_mandatory, c.human_description, c.display_order
FROM public.scholarships s
CROSS JOIN (VALUES
  ('gpa',                 'lte',      '1.75'::jsonb,  TRUE,  'General weighted average of 1.75 or better', 1),
  ('no_major_violations', 'is_true',  'true'::jsonb,  TRUE,  'No record of major disciplinary violations', 2),
  ('no_pending_cases',    'is_true',  'true'::jsonb,  TRUE,  'No pending disciplinary case', 3),
  ('units_enrolled',      'gte',      '18'::jsonb,    TRUE,  'Enrolled in at least 18 units this semester', 4),
  ('no_failing_grades',   'is_true',  'true'::jsonb,  TRUE,  'No failing grade in the previous semester', 5),
  ('year_level',          'in',       '["2nd Year","3rd Year","4th Year"]'::jsonb, FALSE,
                                                              'Preference for 2nd year and above', 6)
) AS c(criterion_key, operator, value, is_mandatory, human_description, display_order)
WHERE s.code = 'PRIV-ACAD'
ON CONFLICT DO NOTHING;

-- ---- Criteria for the government TES program ----
INSERT INTO public.scholarship_criteria
  (scholarship_id, criterion_key, operator, value, is_mandatory, human_description, display_order)
SELECT s.id, c.criterion_key, c.operator, c.value, c.is_mandatory, c.human_description, c.display_order
FROM public.scholarships s
CROSS JOIN (VALUES
  ('is_listahan',      'is_true', 'true'::jsonb,  FALSE, 'Listed in the DSWD Listahanan household registry (priority)', 1),
  ('no_pending_cases', 'is_true', 'true'::jsonb,  TRUE,  'No pending disciplinary case', 2),
  ('scholastic_status','neq',     '"Dismissed"'::jsonb, TRUE, 'Not under dismissal status', 3)
) AS c(criterion_key, operator, value, is_mandatory, human_description, display_order)
WHERE s.code = 'TTF'
ON CONFLICT DO NOTHING;

-- ---- Criteria for the engineering industry grant ----
INSERT INTO public.scholarship_criteria
  (scholarship_id, criterion_key, operator, value, is_mandatory, human_description, display_order)
SELECT s.id, c.criterion_key, c.operator, c.value, c.is_mandatory, c.human_description, c.display_order
FROM public.scholarships s
CROSS JOIN (VALUES
  ('gpa',                 'lte', '2.25'::jsonb,  TRUE,  'General weighted average of 2.25 or better', 1),
  ('year_level',          'in',  '["3rd Year","4th Year"]'::jsonb, TRUE, 'Third or fourth year standing', 2),
  ('no_major_violations', 'is_true', 'true'::jsonb, TRUE, 'No record of major disciplinary violations', 3),
  ('has_no_other_scholarship', 'is_true', 'true'::jsonb, TRUE,
                                'Not currently receiving another scholarship grant', 4)
) AS c(criterion_key, operator, value, is_mandatory, human_description, display_order)
WHERE s.code = 'PRIV-ENG'
ON CONFLICT DO NOTHING;

-- ---- Requirements (document checklists) ----
INSERT INTO public.scholarship_requirements
  (scholarship_id, requirement_name, description, document_type, is_mandatory, obtained_from, display_order)
SELECT s.id, r.requirement_name, r.description, r.document_type, r.is_mandatory, r.obtained_from, r.display_order
FROM public.scholarships s
CROSS JOIN (VALUES
  ('Accomplished application form', 'Scholarship application form, fully filled out and signed.', 'form', TRUE, 'OSA Office', 1),
  ('Certificate of Registration',   'Current semester COR showing enrolled units.', 'certificate', TRUE, 'Registrar / ERS portal', 2),
  ('Copy of rating slip',           'Previous semester grades.', 'transcript', TRUE, 'Registrar / ERS portal', 3),
  ('Certificate of Good Moral Character', 'Issued by OSA confirming no pending cases.', 'certificate', TRUE, 'OSA Office', 4),
  ('2x2 ID photo',                  'Recent photo with white background.', 'photo', TRUE, NULL, 5),
  ('Recommendation letter',         'From a faculty member or department chair.', 'recommendation_letter', FALSE, 'Faculty / Department', 6)
) AS r(requirement_name, description, document_type, is_mandatory, obtained_from, display_order)
WHERE s.code = 'PRIV-ACAD'
ON CONFLICT DO NOTHING;

INSERT INTO public.scholarship_requirements
  (scholarship_id, requirement_name, description, document_type, is_mandatory, obtained_from, display_order)
SELECT s.id, r.requirement_name, r.description, r.document_type, r.is_mandatory, r.obtained_from, r.display_order
FROM public.scholarships s
CROSS JOIN (VALUES
  ('Accomplished TES application form', 'UniFAST application form.', 'form', TRUE, 'OSA Office', 1),
  ('Certificate of Registration', 'Current semester COR.', 'certificate', TRUE, 'Registrar / ERS portal', 2),
  ('Proof of Listahanan listing', 'DSWD certification, if applicable.', 'income_proof', FALSE, 'DSWD / Barangay', 3),
  ('Copy of birth certificate', 'PSA-issued copy.', 'certificate', TRUE, 'PSA', 4),
  ('Copy of student ID', 'Validated for the current semester.', 'id_copy', TRUE, 'OSA / USMS portal', 5)
) AS r(requirement_name, description, document_type, is_mandatory, obtained_from, display_order)
WHERE s.code = 'TTF'
ON CONFLICT DO NOTHING;
