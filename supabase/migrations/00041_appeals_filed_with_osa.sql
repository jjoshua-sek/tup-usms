-- ============================================================
-- 00041 — Appeals are filed with the OSA, which forwards them
-- ============================================================
-- OSA checklist B5. Most of the team recorded the Rules on Discipline
-- (Sec. 9): ten days, decided by the VPAA or Campus Director, the
-- President, or the Board of Regents depending on the sanction. The OSA's
-- former student-body partner and one other said appeals are filed with
-- the OSA. Both hold: the student files with the OSA, and the OSA forwards
-- the appeal to the body that decides it.
--
-- Until now STARS only recorded that a window was open and, later, the
-- outcome; the student could not file anything. On case_appeals:
--   grounds            the student's appeal, in their own words
--   filed_by_student   true when the student filed it through STARS
--   forwarded_at, forwarded_by   when the OSA passed it on, and who
--
-- Students write through the server only (ownership is checked there); the
-- RLS policies stay as they were. Two notifications are added: appeal_filed
-- (to OSA staff) and appeal_forwarded (to the student).
-- ============================================================

ALTER TABLE public.case_appeals
  ADD COLUMN IF NOT EXISTS grounds TEXT CHECK (grounds IS NULL OR char_length(grounds) <= 5000),
  ADD COLUMN IF NOT EXISTS filed_by_student BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forwarded_by UUID REFERENCES public.staff(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_notification_type_check CHECK (
    notification_type IN (
      -- Disciplinary
      'case_filed', 'hearing_scheduled', 'hearing_reminder',
      'hearing_rescheduled', 'apology_required', 'apology_reviewed',
      'settlement_ready', 'case_resolved', 'sanction_applied',
      'case_escalated', 'appeal_window_opened', 'appeal_filed', 'appeal_forwarded',
      -- Scheduling
      'schedule_proposed', 'schedule_approval_needed',
      -- Scholarships
      'scholarship_match', 'scholarship_deadline', 'scholarship_status',
      'masterlist_listed',
      -- Clearance
      'clearance_update', 'clearance_on_hold', 'clearance_ready',
      -- ID validation and gates
      'id_validation_status', 'id_expiring', 'gate_alert',
      -- Guidance & risk
      'guidance_scheduled', 'guidance_reminder', 'intervention_assigned',
      'risk_alert',
      -- Academic documents
      'document_verified', 'document_rejected', 'document_needed',
      -- General
      'announcement', 'general'
    )
  );
