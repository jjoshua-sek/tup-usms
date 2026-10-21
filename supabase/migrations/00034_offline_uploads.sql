-- ============================================================
-- 00034 — Uploads from the offline LAN copy
-- ============================================================
-- During a campus internet outage, the OSA's offline copy keeps two things
-- working: gate scans, and ID validation at the counter. Each is kept in the
-- copy's outbox and uploaded to /api/offline/upload once the internet is
-- back (offline fallback plan, Phase 2). The cloud checks every record with
-- its own rules before it counts.
--
-- 1. access_events.recorded_offline marks scans that happened on the copy,
--    so reports and the gate feed can tell them apart.
-- 2. offline_uploads is both the receipt log and the review list:
--    - one row per uploaded record, keyed by the outbox record's own id, so
--      a record sent twice (the connection dropped mid-upload) is applied
--      once and the second send gets the first answer back;
--    - a record the cloud could not apply as-is (an ID validated offline
--      while the cloud had suspended it) waits with review_status 'open'
--      on the ID Validation page until a staff member marks it reviewed.
-- ============================================================

ALTER TABLE public.access_events
  ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.offline_uploads (
  id             UUID PRIMARY KEY,                 -- the outbox record's id
  kind           TEXT NOT NULL CHECK (kind IN ('gate_scan', 'id_validation')),
  occurred_at    TIMESTAMPTZ NOT NULL,             -- when it happened offline
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload        JSONB NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('applied', 'conflict', 'rejected')),
  detail         TEXT,
  student_id     UUID REFERENCES public.students(id) ON DELETE SET NULL,
  review_status  TEXT NOT NULL DEFAULT 'none' CHECK (review_status IN ('none', 'open', 'resolved')),
  resolved_by    UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  resolved_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_offline_uploads_open
  ON public.offline_uploads (occurred_at)
  WHERE review_status = 'open';

ALTER TABLE public.offline_uploads ENABLE ROW LEVEL SECURITY;

-- OSA staff read the review list. Writes come only from the server: the
-- upload route and the "Mark reviewed" action, both with the service role.
DROP POLICY IF EXISTS "osa staff read offline uploads" ON public.offline_uploads;
CREATE POLICY "osa staff read offline uploads" ON public.offline_uploads
  FOR SELECT TO authenticated
  USING (public.is_osa_staff());

REVOKE ALL ON public.offline_uploads FROM anon;
GRANT SELECT ON public.offline_uploads TO authenticated;
GRANT ALL ON public.offline_uploads TO service_role;
