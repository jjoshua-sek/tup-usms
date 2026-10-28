-- ============================================================
-- 00050 — Students file complaints against students
-- ============================================================
-- The OSA head's review of the checklist (A3): complaints may be filed by
-- students and by any staff member, and only against students. Staff
-- already file cases. A student now files a complaint as a concern of the
-- category 'Complaint', naming who it is against; the OSA identifies that
-- student and files the case from it. Students cannot search the student
-- directory, so the respondent is named in words, not picked from a list.
--
-- 1. 'Complaint' joins the concern categories.
-- 2. A complaint carries respondent_name (required), respondent_details
--    (student number, program or section, if the student knows them),
--    incident_date (required) and incident_location.
-- 3. violation_cases.source_concern_id ties a case to the complaint it came
--    from. The complainant's identity stays on the concern, which only they
--    and OSA staff can read; the case row names them only as "a student".
-- ============================================================

ALTER TABLE public.concerns DROP CONSTRAINT IF EXISTS concerns_category_check;
ALTER TABLE public.concerns
  ADD CONSTRAINT concerns_category_check CHECK (category IN (
    'Academic', 'Facility', 'Personal', 'Financial', 'Technical',
    'Harassment', 'Discrimination', 'Other', 'Complaint'
  ));

ALTER TABLE public.concerns
  ADD COLUMN IF NOT EXISTS respondent_name TEXT
    CHECK (respondent_name IS NULL OR char_length(respondent_name) BETWEEN 2 AND 120),
  ADD COLUMN IF NOT EXISTS respondent_details TEXT
    CHECK (respondent_details IS NULL OR char_length(respondent_details) <= 200),
  ADD COLUMN IF NOT EXISTS incident_date DATE,
  ADD COLUMN IF NOT EXISTS incident_location TEXT
    CHECK (incident_location IS NULL OR char_length(incident_location) <= 120);

ALTER TABLE public.concerns DROP CONSTRAINT IF EXISTS complaint_names_respondent;
ALTER TABLE public.concerns
  ADD CONSTRAINT complaint_names_respondent CHECK (
    category <> 'Complaint' OR (respondent_name IS NOT NULL AND incident_date IS NOT NULL)
  );

ALTER TABLE public.violation_cases
  ADD COLUMN IF NOT EXISTS source_concern_id UUID REFERENCES public.concerns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_violation_cases_source_concern
  ON public.violation_cases(source_concern_id) WHERE source_concern_id IS NOT NULL;
