-- ============================================================
-- 00031 — Gate alerts for OSA staff
-- ============================================================
-- A suspended ID is no longer turned away at the gate. The student is let
-- through and every OSA officer is told, so the office can step in itself
-- instead of leaving it to a guard at the turnstile. A revoked ID (reported
-- lost or stolen) is still refused, and raises the same alert.
--
-- The alert is an ordinary portal notification, in-app only, linked to the
-- access anomaly it reports. This adds the type and the link to the two
-- CHECK constraints on notifications (latest definitions: 00019 and 00020).
-- src/lib/notifications/policy.ts mirrors both lists, and
-- schema-drift.test.ts fails if they drift apart.
--
-- Until this runs, the gate still lets the student through and still files
-- the anomaly; only the inbox alert is missing (the server logs it).
-- ============================================================

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_notification_type_check CHECK (
    notification_type IN (
      -- Disciplinary
      'case_filed', 'hearing_scheduled', 'hearing_reminder',
      'hearing_rescheduled', 'apology_required', 'apology_reviewed',
      'settlement_ready', 'case_resolved', 'sanction_applied',
      'case_escalated', 'appeal_window_opened',
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

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_related_entity_type_check CHECK (
    related_entity_type IN (
      'violation_case', 'case_hearing', 'apology_letter', 'case_settlement',
      'clearance_request', 'scholarship', 'scholarship_application',
      'id_validation', 'guidance_session', 'risk_assessment',
      'risk_intervention', 'academic_document', 'access_anomaly'
    ) OR related_entity_type IS NULL
  );
