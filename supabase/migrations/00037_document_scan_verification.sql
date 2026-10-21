-- ============================================================
-- 00037 — Verifying CORs and rating slips against the stamped paper
-- ============================================================
-- A rating slip from ERS is issued by the student to themselves, and a PDF
-- can be edited; STARS cannot reach ERS to check it. The OSA head's answer:
-- check by scanning. At the ID validation counter the officer already holds
-- the COR and rating slip the Registrar stamped. They photograph each one,
-- STARS reads it, and every row is held against what the student uploaded.
--
-- On academic_documents:
-- 1. integrity_checks   automatic checks run on upload (the student number
--                       and name, the GWA recomputed, units, the grade
--                       scale, what made the PDF and whether it was re-saved).
--                       Flags for the officer, never a rejection.
-- 2. verification_method  how a verified document was verified:
--                       'counter_scan' (against the stamped paper) or
--                       'on_screen' (an officer confirmed the figures).
--                       Documents verified before this migration are
--                       'on_screen', which is what happened to them.
-- 3. stamped_scan_path, scan_comparison, scanned_by, scanned_at
--                       the photo of the stamped paper (kept as evidence, in
--                       the private academic-documents bucket under
--                       stamped/<student_id>/), and what comparing it found.
--
-- The scans are written only by the server (service role) after an OSA
-- check, and read only through short-lived signed links, so the bucket's
-- policies need no change: students can neither read nor write stamped/.
-- ============================================================

ALTER TABLE public.academic_documents
  ADD COLUMN IF NOT EXISTS integrity_checks JSONB,
  ADD COLUMN IF NOT EXISTS verification_method TEXT
    CHECK (verification_method IS NULL OR verification_method IN ('counter_scan', 'on_screen')),
  ADD COLUMN IF NOT EXISTS stamped_scan_path TEXT,
  ADD COLUMN IF NOT EXISTS scan_comparison JSONB,
  ADD COLUMN IF NOT EXISTS scanned_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

UPDATE public.academic_documents
SET verification_method = 'on_screen'
WHERE processing_status = 'verified' AND verification_method IS NULL;

COMMENT ON COLUMN public.academic_documents.verification_method IS
  'counter_scan: matched against the Registrar-stamped paper scanned at the OSA counter. on_screen: an officer confirmed the figures without the stamped copy.';
