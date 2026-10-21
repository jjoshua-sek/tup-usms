-- ============================================================
-- Tables that exist only on the STARS offline LAN copy
-- ============================================================
-- Applied by `node lan/stars.mjs migrate` after the regular migrations.
-- Never run this on the cloud project. Safe to run again.
-- ============================================================

-- When the five-minute copy from the cloud last succeeded, for the offline
-- banner ("records as of 10:42 AM"; red after an hour).
CREATE TABLE IF NOT EXISTS public.offline_sync_state (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_success_at  TIMESTAMPTZ,
  last_attempt_at  TIMESTAMPTZ,
  last_error       TEXT,
  rows_copied      INTEGER
);

INSERT INTO public.offline_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Read by the server with the service role only; nobody signed in reads it
-- directly, so RLS is on with no policies.
ALTER TABLE public.offline_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_sync_state FROM anon, authenticated;
GRANT SELECT ON public.offline_sync_state TO service_role;

-- What happened on the copy during an outage and must reach the cloud
-- (offline fallback plan, Phase 2): gate scans, and IDs validated at the
-- counter. Written by STARS on the copy (lib/access/verify.ts, the ID
-- Validation actions); uploaded by the sync job to /api/offline/upload
-- before every refresh, and never cleared by one.
CREATE TABLE IF NOT EXISTS public.offline_outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('gate_scan', 'id_validation')),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'conflict', 'rejected')),
  detail       TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  uploaded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offline_outbox_pending
  ON public.offline_outbox (occurred_at) WHERE status = 'pending';

ALTER TABLE public.offline_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offline_outbox FROM anon, authenticated;
GRANT ALL ON public.offline_outbox TO service_role;
