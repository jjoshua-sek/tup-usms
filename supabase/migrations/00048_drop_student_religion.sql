-- ============================================================
-- 00048 — Stop keeping students' religion
-- ============================================================
-- The OSA head's review of the checklist (I3): the OSA needs personal and
-- family details and beneficiary status, but not religion. Under RA 10173
-- data that is not needed should not be kept, so the column goes, with the
-- values already entered. The profile form and the consent notice no
-- longer ask for it.
--
-- Run this after the code that no longer writes the column is deployed:
-- until then, saving a profile would send a religion value to a column that
-- is gone.
-- ============================================================

ALTER TABLE public.students DROP COLUMN IF EXISTS religion;
