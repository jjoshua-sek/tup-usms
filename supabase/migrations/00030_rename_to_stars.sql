-- ============================================================
-- 00030: THE SYSTEM IS NAMED STARS
-- ============================================================
-- The project's final title is "STARS: Student Tracking and At-Risk Support
-- System with Integrated OSA Services Using Machine Learning". The app's
-- screens and emails take the name from src/lib/brand.ts; this changes the
-- one place the old name, USMS, reached students through data: a
-- scholarship requirement seeded in 00009 that says where to get a copy of
-- the student ID.
--
-- Internal names stay as they are (the session cookie, gate key prefix,
-- Vault secrets): see the note in src/lib/brand.ts.
-- ============================================================

UPDATE public.scholarship_requirements
SET obtained_from = 'OSA / STARS portal'
WHERE obtained_from = 'OSA / USMS portal';

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT COUNT(*) FROM public.scholarship_requirements
--   WHERE obtained_from ILIKE '%USMS%';                -- 0
