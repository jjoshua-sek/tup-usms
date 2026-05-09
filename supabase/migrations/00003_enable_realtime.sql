-- ============================================================
-- Migration 00003: Enable Realtime on concerns + concern_responses
-- ============================================================
-- Realtime is opt-in per table — adding a table to the
-- supabase_realtime publication broadcasts INSERT/UPDATE/DELETE
-- events to subscribed clients.
--
-- We also need to enable replica identity FULL on these tables so
-- that UPDATE events include the OLD row (needed for some client
-- patterns; harmless overhead otherwise).
--
-- SAFE TO RE-RUN: idempotent (uses ALTER PUBLICATION ADD TABLE
-- with IF NOT EXISTS pattern via DO block).
-- ============================================================

-- 1. Add tables to the realtime publication
DO $$
BEGIN
  -- concerns: students/staff get notified of AI summary updates,
  -- status changes, etc.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'concerns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.concerns;
  END IF;

  -- concern_responses: real-time conversation updates
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'concern_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.concern_responses;
  END IF;
END $$;

-- 2. Set replica identity FULL so UPDATE events include the old row
ALTER TABLE public.concerns REPLICA IDENTITY FULL;
ALTER TABLE public.concern_responses REPLICA IDENTITY FULL;

-- ============================================================
-- VERIFY: After running, you can check via:
--   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- You should see entries for concerns and concern_responses.
-- ============================================================
