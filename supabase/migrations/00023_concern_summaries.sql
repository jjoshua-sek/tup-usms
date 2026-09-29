-- ============================================================
-- 00023: CONCERN SUMMARIES THAT ACTUALLY RUN
-- ============================================================
-- Every concern has shown "AI summary processing…" forever. The summary
-- was meant to come from an Edge Function (supabase/functions/summarize-
-- concern) fired by a database webhook on INSERT — but deploying the
-- function and creating the webhook are dashboard/CLI steps no migration
-- performs, and they were never done. Nothing ever summarized a concern
-- unless a staff member pressed "Re-analyze".
--
-- Summaries now run inside the app: straight after a concern is submitted,
-- with the once-a-minute dispatch job sweeping up anything that failed.
-- These columns give that work a state, so a summary that could not be
-- produced says so instead of "processing" indefinitely.
-- ============================================================

ALTER TABLE public.concerns
  ADD COLUMN IF NOT EXISTS ai_summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ai_summary_status IN ('pending', 'done', 'failed')),
  ADD COLUMN IF NOT EXISTS ai_summary_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_summary_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_summary_error TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_summarized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_key_issues TEXT[];

COMMENT ON COLUMN public.concerns.ai_summary_status IS
  'pending: waiting for (or between) attempts. done: summary saved. failed: gave up after three attempts or a non-retryable refusal; staff can re-run it.';
COMMENT ON COLUMN public.concerns.ai_summary_model IS
  'The model that actually produced the summary — which may differ from the one requested if a fallback served it.';

-- Concerns that already have a summary (from a manual re-analyze) are done.
-- Everything else stays pending, so the sweep summarizes the backlog of
-- stuck concerns the first time it runs.
UPDATE public.concerns SET ai_summary_status = 'done' WHERE ai_summary IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_concerns_summary_queue
  ON public.concerns(created_at)
  WHERE ai_summary_status = 'pending';

-- ------------------------------------------------------------
-- Claiming work
-- ------------------------------------------------------------
-- Two paths summarize: the submit action (immediately) and the minute
-- sweep (as a safety net). Claiming with FOR UPDATE SKIP LOCKED, plus a
-- two-minute hold on anything recently claimed, means they never both pay
-- for the same concern — the same pattern as the email outbox (00019).
--
-- p_concern_id limits the claim to one concern; p_force re-runs a concern
-- regardless of state and resets its attempts (staff "Re-analyze").
CREATE OR REPLACE FUNCTION public.claim_concern_summaries(
  p_limit      INT     DEFAULT 5,
  p_concern_id UUID    DEFAULT NULL,
  p_force      BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id           UUID,
  category     TEXT,
  subject_line TEXT,
  body_text    TEXT,
  attempts     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE public.concerns c
    SET ai_summary_attempts  = CASE WHEN p_force THEN 1 ELSE c.ai_summary_attempts + 1 END,
        ai_summary_claimed_at = NOW(),
        ai_summary_status     = 'pending'
    WHERE c.id IN (
      SELECT q.id
      FROM public.concerns q
      WHERE (p_concern_id IS NULL OR q.id = p_concern_id)
        AND (
          p_force
          OR (
            q.ai_summary_status = 'pending'
            AND q.ai_summary_attempts < 3
            AND (q.ai_summary_claimed_at IS NULL OR q.ai_summary_claimed_at < NOW() - INTERVAL '2 minutes')
            -- A concern a month old is past the point where triage helps.
            AND q.created_at > NOW() - INTERVAL '30 days'
          )
        )
      ORDER BY q.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT p_limit
    )
    RETURNING c.id, c.category, c.subject_line, c.body_text, c.ai_summary_attempts
  )
  SELECT claimed.id, claimed.category, claimed.subject_line, claimed.body_text, claimed.ai_summary_attempts
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_concern_summaries(INT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_concern_summaries(INT, UUID, BOOLEAN) FROM authenticated;

-- ------------------------------------------------------------
-- Verification (run after applying)
-- ------------------------------------------------------------
--   SELECT ai_summary_status, count(*) FROM public.concerns GROUP BY 1;
--   SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'claim_concern_summaries') AS claim_ok;
