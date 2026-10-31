-- ============================================================
-- 00054 — Settle meetings whose case has already moved on
-- ============================================================
-- Until November 1, 2026 nothing changed a meeting's status once the
-- student was summoned: a meeting stayed "student notified" or "confirmed"
-- after it was held, and after its case was dismissed. One student was even
-- reminded on October 27 of a meeting for a case dismissed on October 22
-- (OSA-2026-0002). The app now marks meetings held when a case moves to
-- "Hearing held", cancels upcoming ones when a case is dismissed or closed,
-- and the reminder job skips ended cases. This brings older meetings in
-- line, using only what the case history shows:
--
--   1. Cancelled: a meeting dated after its case was dismissed or closed.
--      It cannot have taken place.
--   2. Held: a past meeting whose case later moved to a status that only
--      follows a meeting (hearing held, an apology, mediation, a
--      settlement, a committee referral, a sanction), recorded in the case
--      history at or after the meeting's start. completed_at is the
--      meeting's scheduled end.
--
-- Anything else is left as it is. A past meeting on a case still at
-- "summons sent" (OSA-2026-0001) is for the officer to record: moving the
-- case to "Hearing held" marks it held, and "Did not appear" records a
-- no-show.
--
-- Each case touched gets one case history entry, from "System". Only
-- meetings still marked as going ahead are changed, so running this twice
-- changes nothing the second time. To check afterwards:
--   SELECT h.status, h.scheduled_start, c.case_number, c.status
--     FROM case_hearings h JOIN violation_cases c ON c.id = h.case_id
--    ORDER BY h.scheduled_start;
-- ============================================================

-- 1. Meetings dated after their case ended.
WITH cancelled AS (
  UPDATE public.case_hearings h
     SET status = 'cancelled'
    FROM public.violation_cases c
   WHERE c.id = h.case_id
     AND c.status IN ('dismissed', 'closed')
     AND c.closed_at IS NOT NULL
     AND h.scheduled_start > c.closed_at
     AND h.status IN ('awaiting_complainant', 'complainant_approved',
                      'student_notified', 'student_acknowledged', 'confirmed')
  RETURNING h.case_id
)
INSERT INTO public.case_timeline (case_id, actor_label, event_type, summary, details)
SELECT case_id,
       'System',
       'note_added',
       CASE WHEN count(*) = 1
            THEN 'The meeting set for this case was cancelled: it fell after the case ended.'
            ELSE count(*) || ' meetings set for this case were cancelled: they fell after the case ended.'
       END,
       jsonb_build_object('meetings_cancelled', count(*), 'migration', '00054')
  FROM cancelled
 GROUP BY case_id;

-- 2. Past meetings the case history shows were followed by an outcome.
WITH held AS (
  UPDATE public.case_hearings h
     SET status = 'completed',
         completed_at = h.scheduled_end
    FROM public.violation_cases c
   WHERE c.id = h.case_id
     AND h.status IN ('student_notified', 'student_acknowledged', 'confirmed')
     AND h.scheduled_start <= now()
     AND c.status IN ('hearing_completed', 'awaiting_apology', 'in_mediation', 'settled',
                      'escalated_pic', 'escalated_sdb', 'referred_codi', 'sanctioned')
     AND EXISTS (
       SELECT 1
         FROM public.case_timeline t
        WHERE t.case_id = c.id
          AND t.to_status IN ('hearing_completed', 'awaiting_apology', 'in_mediation', 'settled',
                              'escalated_pic', 'escalated_sdb', 'referred_codi', 'sanctioned')
          AND t.occurred_at >= h.scheduled_start
     )
  RETURNING h.case_id
)
INSERT INTO public.case_timeline (case_id, actor_label, event_type, summary, details)
SELECT case_id,
       'System',
       'hearing_held',
       CASE WHEN count(*) = 1
            THEN 'The meeting was marked as held, since the case went on to an outcome after it.'
            ELSE count(*) || ' meetings were marked as held, since the case went on to an outcome after them.'
       END,
       jsonb_build_object('meetings_marked_held', count(*), 'migration', '00054')
  FROM held
 GROUP BY case_id;
