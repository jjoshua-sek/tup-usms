-- ============================================================
-- Migration 00012: Guidance Sessions & Notifications
-- ============================================================
-- Two modules:
--   GUIDANCE      — counselling records (the "OSA Guidance" in the title).
--                   Confidentiality is structural, not advisory.
--   NOTIFICATIONS — the delivery layer for requirement #4 ("let a student
--                   know through the portal OR through university email")
--                   and the student notification section in requirement #5.
-- ============================================================

-- ============================================================
-- 1. GUIDANCE SESSIONS
-- ============================================================
-- Counselling notes are the most sensitive data in this system — more so
-- than disciplinary records, because students disclose mental-health and
-- family circumstances in these sessions.
--
-- Two-tier note model:
--   summary           — visible to OSA staff with guidance access
--   confidential_notes — visible ONLY to the counselor who wrote them
--
-- That split is enforced in RLS (migration 00013), not merely by
-- convention, because a counselor must be able to record clinically
-- relevant detail without it becoming readable by disciplinary staff who
-- may later be adjudicating the same student.
CREATE TABLE IF NOT EXISTS public.guidance_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  counselor_id    UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,

  session_type    TEXT NOT NULL CHECK (session_type IN (
    'walk_in',         -- student came in unprompted
    'scheduled',
    'referral',        -- referred by faculty or OSA
    'risk_intervention', -- triggered by the early warning system
    'disciplinary',    -- counselling attached to a minor offense
    'follow_up',
    'crisis'
  )),

  -- Optional links back to what prompted the session.
  related_case_id         UUID REFERENCES public.violation_cases(id) ON DELETE SET NULL,
  related_intervention_id UUID REFERENCES public.risk_interventions(id) ON DELETE SET NULL,

  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,

  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'completed', 'no_show', 'cancelled', 'rescheduled'
  )),

  presenting_concern TEXT,
  -- Broad category, safe for aggregate reporting without exposing detail.
  concern_category TEXT CHECK (concern_category IN (
    'academic', 'financial', 'family', 'mental_health', 'career',
    'peer_relations', 'disciplinary', 'health', 'other'
  ) OR concern_category IS NULL),

  -- Tier 1: shareable with OSA staff who hold guidance access
  summary         TEXT,
  -- Tier 2: counselor-only
  confidential_notes TEXT,

  action_items    TEXT,
  referral_made_to TEXT,   -- external referral, e.g. university clinic
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date  DATE,

  -- 'restricted' is the default: guidance notes are not general-access.
  confidentiality TEXT NOT NULL DEFAULT 'restricted'
    CHECK (confidentiality IN ('restricted', 'counselor_only')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_guidance_student
  ON public.guidance_sessions(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guidance_counselor
  ON public.guidance_sessions(counselor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_guidance_followup
  ON public.guidance_sessions(follow_up_date)
  WHERE follow_up_required AND status = 'completed';
CREATE INDEX IF NOT EXISTS idx_guidance_upcoming
  ON public.guidance_sessions(scheduled_at)
  WHERE status = 'scheduled';

DROP TRIGGER IF EXISTS trg_guidance_updated_at ON public.guidance_sessions;
CREATE TRIGGER trg_guidance_updated_at
  BEFORE UPDATE ON public.guidance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. NOTIFICATIONS
-- ============================================================
-- Single table serving both the in-portal notification feed and the
-- institutional webmail dispatch the OSA document calls for ("Automated
-- Webmail/Gmail Notification Module").
--
-- Delivery state per channel is tracked separately, because a summons that
-- appeared in the portal but failed to email is a materially different
-- situation from one that was never sent at all — and for a disciplinary
-- summons, proof of delivery matters.
CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  notification_type TEXT NOT NULL CHECK (notification_type IN (
    -- Disciplinary
    'case_filed', 'hearing_scheduled', 'hearing_reminder',
    'hearing_rescheduled', 'apology_required', 'apology_reviewed',
    'settlement_ready', 'case_resolved', 'sanction_applied',
    -- Scheduling (requirement #1)
    'schedule_proposed', 'schedule_approval_needed',
    -- Scholarships
    'scholarship_match', 'scholarship_deadline', 'scholarship_status',
    'masterlist_listed',
    -- Clearance
    'clearance_update', 'clearance_on_hold', 'clearance_ready',
    -- ID validation
    'id_validation_status', 'id_expiring',
    -- Guidance & risk
    'guidance_scheduled', 'guidance_reminder', 'intervention_assigned',
    'risk_alert',           -- staff-facing
    -- Academic documents
    'document_verified', 'document_rejected', 'document_needed',
    -- General
    'announcement', 'general'
  )),

  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  action_url      TEXT,        -- deep link into the portal
  action_label    TEXT,        -- e.g. "View hearing details"

  priority        TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Which channels were requested for this notification.
  channels        TEXT[] NOT NULL DEFAULT ARRAY['in_app'],

  -- IN-APP delivery state
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,

  -- EMAIL delivery state (institutional webmail)
  email_status    TEXT CHECK (email_status IN (
    'not_applicable', 'queued', 'sent', 'failed', 'bounced'
  ) OR email_status IS NULL),
  email_sent_at   TIMESTAMPTZ,
  email_error     TEXT,
  email_recipient TEXT,   -- the address actually used, for the audit trail

  -- Polymorphic link to the originating record.
  related_entity_type TEXT CHECK (related_entity_type IN (
    'violation_case', 'case_hearing', 'clearance_request',
    'scholarship', 'scholarship_application', 'id_validation',
    'guidance_session', 'risk_assessment', 'risk_intervention',
    'academic_document'
  ) OR related_entity_type IS NULL),
  related_entity_id UUID,

  -- Notifications with a natural shelf life (a hearing reminder after the
  -- hearing is noise) can be swept by a cleanup job.
  expires_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user
  ON public.notifications(user_id, created_at DESC);
-- The unread badge query. Partial index keeps it fast as history grows.
CREATE INDEX IF NOT EXISTS idx_notif_unread
  ON public.notifications(user_id, created_at DESC) WHERE NOT is_read;
CREATE INDEX IF NOT EXISTS idx_notif_entity
  ON public.notifications(related_entity_type, related_entity_id)
  WHERE related_entity_id IS NOT NULL;
-- Dispatch worker queue.
CREATE INDEX IF NOT EXISTS idx_notif_email_queue
  ON public.notifications(created_at)
  WHERE email_status IN ('queued', 'failed');

-- ============================================================
-- 3. NOTIFICATION PREFERENCES
-- ============================================================
-- Per-user channel opt-outs. Deliberately does NOT allow opting out of
-- disciplinary notifications: a student cannot mute a summons. The
-- application enforces that by ignoring preferences for the
-- always_deliver types listed below.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  -- Category-level toggles for non-mandatory notifications.
  scholarship_alerts  BOOLEAN NOT NULL DEFAULT TRUE,
  guidance_reminders  BOOLEAN NOT NULL DEFAULT TRUE,
  announcements       BOOLEAN NOT NULL DEFAULT TRUE,

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notification_preferences IS
  'Channel preferences. Disciplinary notification types (case_filed, hearing_scheduled, hearing_reminder, sanction_applied, apology_required) bypass these settings and are always delivered on every available channel — a student cannot opt out of a summons.';

-- ============================================================
-- 4. NOTIFICATION HELPER
-- ============================================================
-- Centralizes creation so every call site records provenance consistently.
-- SECURITY DEFINER: a staff action must be able to create a notification
-- addressed to a student, which the caller's own RLS scope would not allow.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id       UUID,
  p_type          TEXT,
  p_title         TEXT,
  p_body          TEXT,
  p_priority      TEXT DEFAULT 'normal',
  p_channels      TEXT[] DEFAULT ARRAY['in_app'],
  p_action_url    TEXT DEFAULT NULL,
  p_action_label  TEXT DEFAULT NULL,
  p_entity_type   TEXT DEFAULT NULL,
  p_entity_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
  wants_email BOOLEAN;
BEGIN
  wants_email := 'email' = ANY(p_channels);

  INSERT INTO public.notifications (
    user_id, notification_type, title, body, priority, channels,
    action_url, action_label, related_entity_type, related_entity_id,
    email_status
  ) VALUES (
    p_user_id, p_type, p_title, p_body, p_priority, p_channels,
    p_action_url, p_action_label, p_entity_type, p_entity_id,
    CASE WHEN wants_email THEN 'queued' ELSE 'not_applicable' END
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_notification(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, UUID
) TO authenticated;
