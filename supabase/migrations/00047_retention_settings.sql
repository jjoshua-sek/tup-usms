-- ============================================================
-- 00047 — Record retention, as the DPO sets it
-- ============================================================
-- OSA checklist I4. Most of the team recorded "5 years after graduation";
-- the OSA's former student-body partner said the Data Protection Officer
-- sets it. Both hold: 5 years stays the starting value, and it is now a
-- setting, so the DPO's decision needs no code change. STARS showed it as
-- fixed text before ("5 years after graduation", "Access logs are kept for
-- 180 days").
--
-- system_settings is a small key/value store. Everyone signed in may read
-- it (students see the retention period in the consent notice and on their
-- Digital ID page); only the administrator changes it, recording the DPO's
-- memo or reference.
--
-- purge_access_events_by_setting() runs the existing purge (00015) with the
-- days the DPO set. Nothing schedules it here: deleting records on a timer
-- is the OSA's and the DPO's decision to switch on, with
--   SELECT cron.schedule('purge-access-events', '0 3 * * *',
--     $$SELECT public.purge_access_events_by_setting()$$);
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.system_settings (key, value) VALUES
  ('record_retention_years', '5'::jsonb),
  ('access_log_retention_days', '180'::jsonb),
  ('retention_dpo_reference', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "signed-in users read settings" ON public.system_settings;
CREATE POLICY "signed-in users read settings" ON public.system_settings
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "admin changes settings" ON public.system_settings;
CREATE POLICY "admin changes settings" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.current_staff_role() = 'admin')
  WITH CHECK (public.current_staff_role() = 'admin');

REVOKE ALL ON public.system_settings FROM anon;
GRANT SELECT, UPDATE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;

CREATE OR REPLACE FUNCTION public.purge_access_events_by_setting()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  days INTEGER;
BEGIN
  SELECT (value #>> '{}')::INTEGER INTO days FROM public.system_settings WHERE key = 'access_log_retention_days';
  RETURN public.purge_access_events(COALESCE(days, 180));
END;
$$;

REVOKE ALL ON FUNCTION public.purge_access_events_by_setting() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_access_events_by_setting() TO service_role;
