-- ============================================================
-- 00020: STUDENT RECORD ACCESS
-- ============================================================
-- Two changes, both surfaced while building the staff view of a single
-- student's record (/staff/students/[id]).
--
--   1. A second silent notification failure. `notifications` carries two
--      CHECK constraints, and 00019 corrected only one of them.
--   2. OSA staff can now read the notices the system served to a student,
--      so the record can show proof of service.
-- ============================================================

-- ------------------------------------------------------------
-- 1. related_entity_type — the second constraint
-- ------------------------------------------------------------
-- 00019 fixed notification_type but left related_entity_type alone. Two
-- call sites pass entity types this list rejects:
--
--   apology_letter   — "Your apology letter was accepted / needs changes"
--   case_settlement  — "A settlement is waiting for your agreement"
--
-- Both calls discard the RPC result, so the insert fails without a trace:
-- no student has ever been told that a settlement awaits their signature,
-- or that their apology letter was sent back for changes. settlement_ready
-- is on the mandatory-delivery list, which makes the first one a failure
-- to serve notice.
--
-- The TypeScript union in src/lib/notifications/policy.ts now mirrors this
-- list, and src/lib/notifications/schema-drift.test.ts fails whenever the
-- two disagree — so a third instance of this is a failing test, not a
-- silent production defect.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_related_entity_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_related_entity_type_check CHECK (
    related_entity_type IN (
      'violation_case', 'case_hearing', 'apology_letter', 'case_settlement',
      'clearance_request', 'scholarship', 'scholarship_application',
      'id_validation', 'guidance_session', 'risk_assessment',
      'risk_intervention', 'academic_document'
    ) OR related_entity_type IS NULL
  );

-- ------------------------------------------------------------
-- 2. Proof of service
-- ------------------------------------------------------------
-- Until now a notification was readable only by the person it was
-- addressed to. That is right for the feed, but it leaves the OSA unable to
-- answer the question that matters most before proceeding ex parte under
-- Rules on Discipline Sec. 7.7: was this student actually told? The
-- delivery record — created, read in the portal, emailed and to which
-- address — already exists on each row. This lets OSA staff see it.
--
-- Scoped by related_entity_type, not opened wholesale:
--   * Included: the records OSA staff can already read — cases, hearings,
--     apologies, settlements, clearance, scholarship applications, ID
--     validation, academic documents.
--   * Excluded: guidance_session, risk_assessment and risk_intervention.
--     Guidance is compartmentalised from discipline (00013), and a notice
--     that a student has a counselling appointment is itself a disclosure
--     that they are in counselling.
--   * Excluded: rows with no entity (announcements, general notices, and
--     the staff-facing risk alerts), which are not notices served on anyone.
--
-- SELECT only. The existing UPDATE policy still limits marking a notice
-- read to its recipient; staff cannot alter the delivery record.
-- Every existing query on this table already filters by user_id itself,
-- so no student's or staff member's own feed changes.
DROP POLICY IF EXISTS "osa reads served notices" ON public.notifications;
CREATE POLICY "osa reads served notices" ON public.notifications
  FOR SELECT USING (
    public.is_osa_staff()
    AND related_entity_type IN (
      'violation_case', 'case_hearing', 'apology_letter', 'case_settlement',
      'clearance_request', 'scholarship_application', 'id_validation',
      'academic_document'
    )
  );

-- Supports "every notice served on this student", newest first.
CREATE INDEX IF NOT EXISTS idx_notif_user_entity
  ON public.notifications(user_id, created_at DESC)
  WHERE related_entity_type IS NOT NULL;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT pg_get_constraintdef(oid) LIKE '%case_settlement%' AS entity_fix,
--          EXISTS (SELECT 1 FROM pg_policies
--                  WHERE tablename = 'notifications'
--                    AND policyname = 'osa reads served notices') AS proof_of_service
--   FROM pg_constraint
--   WHERE conname = 'notifications_related_entity_type_check';
