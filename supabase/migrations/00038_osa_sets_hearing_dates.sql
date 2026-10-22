-- ============================================================
-- 00038 — The OSA sets hearing dates
-- ============================================================
-- OSA checklist C1, as the OSA's former student-body partner described it:
-- the OSA sets the date; the complainant does not approve it first. A
-- hearing used to wait at 'awaiting_complainant' until the faculty
-- complainant approved, and a constraint (notify_requires_approval)
-- refused to record a summons before that approval. Many complainants have
-- no STARS account, and a student complainant had no approval step at all.
--
-- Now an OSA officer picks the slot and the summons goes out with it. The
-- officer who set the date and when are recorded (date_set_by, date_set_at),
-- and the constraint accepts either that or a complainant's approval, so
-- hearings scheduled the old way keep their history.
-- ============================================================

ALTER TABLE public.case_hearings
  ADD COLUMN IF NOT EXISTS date_set_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_set_at TIMESTAMPTZ;

COMMENT ON COLUMN public.case_hearings.date_set_by IS
  'The OSA officer who set the hearing date (checklist C1). Null for hearings a complainant approved under the old process.';

ALTER TABLE public.case_hearings DROP CONSTRAINT IF EXISTS notify_requires_approval;
ALTER TABLE public.case_hearings DROP CONSTRAINT IF EXISTS notify_requires_date;
ALTER TABLE public.case_hearings
  ADD CONSTRAINT notify_requires_date CHECK (
    student_notified_at IS NULL
    OR date_set_at IS NOT NULL
    OR complainant_approved_at IS NOT NULL
  );
