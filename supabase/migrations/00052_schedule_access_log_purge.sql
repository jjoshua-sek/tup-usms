-- ============================================================
-- 00052 — Delete old gate scans every night, as the DPO's period says
-- ============================================================
-- The consent notice and the Digital ID page tell students that gate logs
-- are kept for the period in system_settings.access_log_retention_days
-- (180 days unless the administrator records the DPO's decision). Until
-- now nothing deleted them: 00015 and 00047 left the schedule switched off
-- for the OSA and the DPO to decide. It is switched on from October 29, 2026.
--
-- The job runs purge_access_events_by_setting() (00047) at 3 AM Manila
-- time; pg_cron runs on UTC, hence 19:00. It reads the period on every run,
-- so a new decision only needs the setting changed. It deletes access_events
-- only, never fewer than 30 days back (00015), and keeps scans behind an
-- open or confirmed gate alert.
--
-- Scheduled only where pg_cron is enabled and only in the cloud. The
-- offline copy (lan/, marked by its lan_meta schema) replaces its tables
-- with the cloud's on every refresh, so old scans leave it from there; a
-- purge of its own could only reach scans still waiting to upload.
--
-- cron.schedule() updates a job of the same name, so running this twice
-- is harmless. To check:
--   SELECT jobname, schedule, command, active FROM cron.job
--    WHERE jobname = 'purge-access-events';
-- To stop:  SELECT cron.unschedule('purge-access-events');
-- ============================================================

DO $do$
BEGIN
  IF to_regnamespace('lan_meta') IS NOT NULL THEN
    RAISE NOTICE 'Offline copy: the access log purge is not scheduled here.';
  ELSIF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron is not enabled: the access log purge is not scheduled.';
  ELSE
    PERFORM cron.schedule(
      'purge-access-events',
      '0 19 * * *',
      $job$ SELECT public.purge_access_events_by_setting(); $job$
    );
  END IF;
END
$do$;
