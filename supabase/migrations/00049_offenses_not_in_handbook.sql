-- ============================================================
-- 00049 — Offenses the Student Manual does not list
-- ============================================================
-- The OSA head's review of the checklist (A2): a case is classified by the
-- Student Manual first; only an offense the Manual does not list is
-- classified by the OSA, and the sanction is always the OSA's to decide.
--
-- Every seeded type is a Manual offense, so its classification still comes
-- from the type when the case is filed. OTH-01 is the one type outside the
-- Manual: a case filed under it waits, marked classification_pending, until
-- an OSA officer classifies it as minor or major. Its stored classification
-- ('minor') is a placeholder until then; the app shows it as "to be
-- classified" and holds back the minor process and hearings.
-- ============================================================

ALTER TABLE public.violation_types
  ADD COLUMN IF NOT EXISTS in_handbook BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO public.violation_types
  (code, name, description, default_classification, handbook_reference, typical_sanction, auto_route_codi, in_handbook)
VALUES
  ('OTH-01', 'Offense not in the Student Manual',
   'Conduct the Student Manual does not list. The OSA classifies it as minor or major after review, and decides the sanction.',
   'minor', NULL, 'Decided by the OSA', FALSE, FALSE)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.violation_cases
  ADD COLUMN IF NOT EXISTS classification_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS classified_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
