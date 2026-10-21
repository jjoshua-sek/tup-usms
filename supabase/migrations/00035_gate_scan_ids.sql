-- ============================================================
-- 00035 — One record per gate scan, wherever it was decided
-- ============================================================
-- A kiosk asks the cloud first and, after a few seconds without an answer,
-- the OSA's offline copy. Giving up on the cloud does not stop it: a slow
-- cloud can still finish and record the scan, and the copy records the same
-- scan again, to be uploaded later. On 2026-10-21 one scan was recorded
-- twice that way, allowed by the cloud and denied by the copy.
--
-- The kiosk now gives each scan its own id and sends the same id to both.
-- The cloud keeps at most one event per id: an uploaded scan whose id the
-- cloud already recorded is acknowledged and not added again.
--
-- Scans without an id (the OSA desk, kiosks not yet reloaded) are unaffected.
-- ============================================================

ALTER TABLE public.access_events
  ADD COLUMN IF NOT EXISTS scan_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_access_events_scan_id
  ON public.access_events (scan_id)
  WHERE scan_id IS NOT NULL;
