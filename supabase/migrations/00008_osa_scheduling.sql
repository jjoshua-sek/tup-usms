-- ============================================================
-- Migration 00008: Intelligent Hearing Scheduling
-- ============================================================
-- Supports requirement #1: the system cross-checks the complainant's
-- (professor's) and the complainee's (student's) schedules to find viable
-- meeting slots for a disciplinary conference. The professor approves a
-- slot BEFORE the student is notified — that ordering is enforced by the
-- notify_requires_approval constraint on case_hearings (migration 00007).
--
-- DATA SOURCES for availability, in priority order:
--   1. Class schedule parsed from the student's uploaded Certificate of
--      Registration (source = 'cor_import') — see migration 00011.
--   2. Manually declared blocks entered by the user in the portal.
--   3. Derived busy blocks from already-scheduled hearings.
--
-- The scheduling algorithm itself lives in TypeScript
-- (src/lib/scheduling/find-slots.ts) rather than as a SQL function, because
-- slot *scoring* is a product decision that will be tuned frequently and
-- benefits from unit tests.
-- ============================================================

-- ============================================================
-- 1. AVAILABILITY BLOCKS
-- ============================================================
-- A single table handles both recurring weekly commitments (a MWF class)
-- and one-off blocks (a conference on a specific date). Exactly one of
-- day_of_week / specific_date must be set — enforced by CHECK below.
CREATE TABLE IF NOT EXISTS public.availability_blocks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Applies to any system user: students and staff both declare availability.
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- RECURRING: day_of_week set, specific_date NULL
  day_of_week   TEXT CHECK (day_of_week IN (
    'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'
  ) OR day_of_week IS NULL),

  -- ONE-OFF: specific_date set, day_of_week NULL
  specific_date DATE,

  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,

  -- 'busy' blocks subtract from availability; 'free' blocks are explicit
  -- opt-ins used when a user wants to declare narrow office hours rather
  -- than "any time not marked busy."
  block_type    TEXT NOT NULL DEFAULT 'busy'
    CHECK (block_type IN ('busy', 'free')),

  -- What created this block. 'cor_import' rows are regenerated whenever a
  -- new Certificate of Registration is verified, so they are safe to delete
  -- and recreate as a set.
  source        TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'cor_import', 'hearing', 'system')),

  label         TEXT,   -- e.g. "IT 401 - Capstone" or "Thesis defense"

  -- For recurring class blocks, the term they belong to. Lets us expire
  -- last semester's schedule without deleting history.
  school_year   TEXT,
  semester      TEXT,
  valid_from    DATE,
  valid_until   DATE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (end_time > start_time),
  -- Exactly one of recurring / one-off
  CONSTRAINT recurring_xor_specific CHECK (
    (day_of_week IS NOT NULL AND specific_date IS NULL) OR
    (day_of_week IS NULL     AND specific_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_availability_user
  ON public.availability_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_availability_recurring
  ON public.availability_blocks(user_id, day_of_week)
  WHERE day_of_week IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_availability_specific
  ON public.availability_blocks(user_id, specific_date)
  WHERE specific_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_availability_source
  ON public.availability_blocks(source, school_year, semester);

-- ============================================================
-- 2. HEARING SLOT PROPOSALS
-- ============================================================
-- The scheduling algorithm writes its ranked candidates here. The
-- complainant sees this list and picks one; picking converts the chosen
-- proposal into a case_hearings row.
--
-- Persisting proposals (rather than computing them on the fly each page
-- load) matters for two reasons: the professor's approval must reference
-- a stable slot, and the rationale text becomes part of the case record
-- showing the schedule was determined systematically, not arbitrarily.
CREATE TABLE IF NOT EXISTS public.hearing_slot_proposals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id        UUID NOT NULL REFERENCES public.violation_cases(id) ON DELETE CASCADE,

  proposed_start TIMESTAMPTZ NOT NULL,
  proposed_end   TIMESTAMPTZ NOT NULL,

  -- 0.0–1.0 desirability from the scoring function. Higher is better.
  score          NUMERIC(4,3) NOT NULL DEFAULT 0
    CHECK (score >= 0 AND score <= 1),

  -- Human-readable justification shown to the professor, e.g.
  -- "Both free · 3 days out · mid-morning". Also written into the case
  -- timeline so the rationale survives even if proposals are purged.
  rationale      TEXT,

  -- Snapshot of the scoring inputs, so a proposal can be explained later
  -- even after availability data changes.
  score_factors  JSONB,

  -- Rank within this generation batch (1 = best).
  rank           INT NOT NULL DEFAULT 1,

  -- Groups proposals generated together, so regenerating supersedes the
  -- previous batch rather than mixing with it.
  batch_id       UUID NOT NULL DEFAULT uuid_generate_v4(),

  status         TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'selected', 'rejected', 'superseded', 'expired')),

  selected_by    UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  selected_at    TIMESTAMPTZ,

  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (proposed_end > proposed_start)
);

CREATE INDEX IF NOT EXISTS idx_proposals_case
  ON public.hearing_slot_proposals(case_id, rank);
CREATE INDEX IF NOT EXISTS idx_proposals_batch
  ON public.hearing_slot_proposals(batch_id);
CREATE INDEX IF NOT EXISTS idx_proposals_active
  ON public.hearing_slot_proposals(case_id, score DESC)
  WHERE status = 'suggested';

-- ============================================================
-- 3. SCHEDULING CONFIGURATION
-- ============================================================
-- Tunable parameters for the slot finder, stored in the DB so OSA can
-- adjust them without a redeploy (e.g. shortening the notice period
-- during a busy disciplinary season).
CREATE TABLE IF NOT EXISTS public.scheduling_config (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key             TEXT NOT NULL UNIQUE,
  config_value           JSONB NOT NULL,
  description            TEXT,
  updated_by             UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.scheduling_config (config_key, config_value, description) VALUES
  ('min_notice_days', '2',
   'Minimum business days between now and the earliest proposable slot. Gives the student time to prepare, which is a due-process consideration.'),
  ('max_horizon_days', '14',
   'Latest a slot may be proposed. Keeps cases from drifting.'),
  ('hearing_duration_minutes', '45',
   'Default conference length.'),
  ('business_hours', '{"start": "08:00", "end": "17:00"}',
   'Campus working window for hearings.'),
  ('lunch_break', '{"start": "12:00", "end": "13:00"}',
   'Excluded from proposals.'),
  ('preferred_windows', '[{"start":"09:00","end":"11:00","bonus":0.15},{"start":"14:00","end":"16:00","bonus":0.10}]',
   'Time ranges that receive a scoring bonus. Mid-morning and mid-afternoon are when attendance and attention are best.'),
  ('avoid_friday_afternoon', 'true',
   'Friday afternoon slots are penalized: attendance is poor and follow-up cannot happen until Monday.'),
  ('max_proposals', '5',
   'How many ranked options to present to the complainant.')
ON CONFLICT (config_key) DO NOTHING;
