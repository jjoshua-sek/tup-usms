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
