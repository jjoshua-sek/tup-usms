-- ============================================================
-- 00018 — SANCTION LADDER, COMMUNITY SERVICE, APPEALS
-- ============================================================
-- Everything here comes from the TUP Student Handbook, not from OSA practice,
-- so it can be built before the office verifies the open questions.
--
--   Table of Offenses (Minor)   first offense  → warning + letter of apology
--                               second         → 10 to 20 hours community service
--                               third          → 30 to 50 hours community service
--
--   Rules on Discipline Sec. 9  appeal routes and the 10-day windows:
--                               ≤ 30 days' suspension → VPAA / Campus Director
--                               one semester          → Office of the President
--                               dismissal / expulsion → OP, then Board of Regents
--
-- Two policy details the handbook does NOT settle are left as explicit,
-- changeable columns rather than assumptions baked into logic:
--   * whether the offense count resets each term or runs cumulatively
--     (`count_basis` on each assignment records which reading was used)
--   * who verifies completed service hours (`verified_by` plus a free-text
--     `verifier_role` for offices that are not USMS users)
-- ============================================================

-- ------------------------------------------------------------
-- 1. COMMUNITY SERVICE — the second and third rungs of the ladder
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_service_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       UUID NOT NULL REFERENCES public.violation_cases(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- Which rung of the ladder this is: 2 or 3 under the handbook table, higher
  -- if the office escalates beyond it.
  offense_sequence INT NOT NULL CHECK (offense_sequence >= 1),
  -- How that sequence number was reached, since the handbook doesn't say.
  count_basis   TEXT NOT NULL DEFAULT 'cumulative' CHECK (count_basis IN (
    'cumulative',      -- every prior minor offense on record
    'school_year',     -- prior offenses in the same school year
    'term',            -- prior offenses in the same semester or term
    'same_offense'     -- prior offenses of the same type only
  )),

  hours_required INT NOT NULL CHECK (hours_required BETWEEN 1 AND 200),
  -- The band the handbook prescribes, kept so a reviewer can see the assigned
  -- figure sits inside it.
  band_min      INT CHECK (band_min IS NULL OR band_min >= 0),
  band_max      INT CHECK (band_max IS NULL OR band_max >= 0),
  handbook_reference TEXT,

  service_detail TEXT,   -- what the student will actually do, and where
  deadline      DATE,

  assigned_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  hours_completed NUMERIC(5,1) NOT NULL DEFAULT 0
    CHECK (hours_completed >= 0 AND hours_completed <= 500),
  verified_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  -- For sign-off by an office that has no account here (a laboratory, the
  -- library, a dean's office).
  verifier_role TEXT,
  verified_at   TIMESTAMPTZ,
  verification_notes TEXT,

  status        TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN (
    'assigned',
    'in_progress',
    'completed',
    'not_served',   -- deadline passed with hours outstanding
    'waived'
  )),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_case ON public.community_service_assignments(case_id);
CREATE INDEX IF NOT EXISTS idx_service_student
  ON public.community_service_assignments(student_id, assigned_at DESC);
-- Outstanding service blocks clearance, so this is a hot lookup.
CREATE INDEX IF NOT EXISTS idx_service_outstanding
  ON public.community_service_assignments(student_id)
  WHERE status IN ('assigned', 'in_progress', 'not_served');

DROP TRIGGER IF EXISTS trg_service_updated_at ON public.community_service_assignments;
CREATE TRIGGER trg_service_updated_at
  BEFORE UPDATE ON public.community_service_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. APPEALS — Rules on Discipline, Section 9
-- ------------------------------------------------------------
-- The appeal is filed with a body outside the OSA, so this table tracks a
-- process the office does not run. Its value is the clock: the student has 10
-- days from receipt of the Notice of Decision, and nobody should have to work
-- that out by hand.
CREATE TABLE IF NOT EXISTS public.case_appeals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       UUID NOT NULL REFERENCES public.violation_cases(id) ON DELETE CASCADE,
  escalation_id UUID REFERENCES public.case_escalations(id) ON DELETE SET NULL,

  -- Which rung of Sec. 9 applies, which is what fixes the appellate body.
  penalty_basis TEXT NOT NULL CHECK (penalty_basis IN (
    'suspension_up_to_30_days',
    'suspension_one_semester',
    'dismissal_or_expulsion',
    'other'
  )),
  appellate_body TEXT NOT NULL CHECK (appellate_body IN (
    'vpaa_or_campus_director',
    'office_of_the_president',
    'board_of_regents'
  )),

  -- The clock starts when the student receives the Notice of Decision.
  notice_received_on DATE NOT NULL,
  appeal_deadline    DATE NOT NULL,
  filed_on           DATE,

  status        TEXT NOT NULL DEFAULT 'window_open' CHECK (status IN (
    'window_open',   -- decision served, student may still appeal
    'filed',
    'decided',
    'lapsed',        -- window closed without an appeal; decision is final
    'withdrawn'
  )),

  outcome       TEXT CHECK (outcome IN (
    'upheld', 'modified', 'reversed', 'remanded', 'dismissed'
  ) OR outcome IS NULL),
  outcome_notes TEXT,
  decided_on    DATE,
  -- Reference number from the appellate office's own records.
  external_reference TEXT,

  recorded_by   UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT appeal_deadline_after_notice CHECK (appeal_deadline >= notice_received_on)
);

CREATE INDEX IF NOT EXISTS idx_appeals_case ON public.case_appeals(case_id);
CREATE INDEX IF NOT EXISTS idx_appeals_open
  ON public.case_appeals(appeal_deadline)
  WHERE status IN ('window_open', 'filed');

DROP TRIGGER IF EXISTS trg_appeals_updated_at ON public.case_appeals;
CREATE TRIGGER trg_appeals_updated_at
  BEFORE UPDATE ON public.case_appeals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 3. ID LIFECYCLE — surrender on clearance
-- ------------------------------------------------------------
-- "Before the release of the credentials, the student is required to surrender
-- his university ID to the Office of Student Affairs" (Application for
-- Clearance). A surrendered ID must stop opening turnstiles, which needs a
-- state of its own — 'revoked' would misrepresent a graduate as a sanction.
ALTER TABLE public.id_validations DROP CONSTRAINT IF EXISTS id_validations_status_check;
ALTER TABLE public.id_validations
  ADD CONSTRAINT id_validations_status_check CHECK (status IN (
    'pending',
    'under_review',
    'validated',
    'rejected',
    'expired',
    'suspended',
    'revoked',
    'surrendered'
  ));

-- A surrendered ID must be denied at the gate with its own reason, so the log
-- distinguishes a graduate from a sanction.
ALTER TABLE public.access_events DROP CONSTRAINT IF EXISTS access_events_reason_check;
ALTER TABLE public.access_events
  ADD CONSTRAINT access_events_reason_check CHECK (reason IN (
    'ok',
    'unreadable',
    'not_found',
    'not_validated',
    'expired',
    'suspended',
    'revoked',
    'surrendered',
    'passback',
    'concurrent_use',
    'gate_inactive',
    'duplicate_scan'
  ));

-- ------------------------------------------------------------
-- 4. CLEARANCE HOLDS — outstanding service is a blocker
-- ------------------------------------------------------------
ALTER TABLE public.clearance_holds DROP CONSTRAINT IF EXISTS clearance_holds_hold_reason_check;
ALTER TABLE public.clearance_holds
  ADD CONSTRAINT clearance_holds_hold_reason_check CHECK (hold_reason IN (
    'pending_violation_case',
    'unresolved_sanction',
    'unsubmitted_apology_letter',
    'unsigned_settlement',
    'unserved_community_service',
    'unpaid_fee',
    'unreturned_item',
    'missing_document',
    'incomplete_requirements',
    'other'
  ));

-- The clearance check now also counts outstanding service hours. Same shape as
-- before so callers don't change: a JSONB verdict plus the blocking detail.
CREATE OR REPLACE FUNCTION public.check_student_clearance(p_student_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_count       INT;
  unresolved_sanction INT;
  unsubmitted_apology INT;
  unserved_service    INT;
  blocking_cases      JSONB;
  verdict             TEXT;
BEGIN
  SELECT COUNT(*) INTO pending_count
  FROM public.violation_cases
  WHERE student_id = p_student_id
    AND status NOT IN ('closed', 'dismissed');

  SELECT COUNT(*) INTO unresolved_sanction
  FROM public.violation_cases
  WHERE student_id = p_student_id
    AND status = 'sanctioned'
    AND closed_at IS NULL;

  SELECT COUNT(*) INTO unsubmitted_apology
  FROM public.violation_cases vc
  WHERE vc.student_id = p_student_id
    AND vc.status = 'awaiting_apology'
    AND NOT EXISTS (
      SELECT 1 FROM public.apology_letters al
      WHERE al.case_id = vc.id AND al.review_status = 'accepted'
    );

  SELECT COUNT(*) INTO unserved_service
  FROM public.community_service_assignments
  WHERE student_id = p_student_id
    AND status IN ('assigned', 'in_progress', 'not_served');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'case_id',        id,
    'case_number',    case_number,
    'classification', classification,
    'status',         status,
    'incident_date',  incident_date
  )), '[]'::jsonb)
  INTO blocking_cases
  FROM public.violation_cases
  WHERE student_id = p_student_id
    AND status NOT IN ('closed', 'dismissed')
    AND confidentiality <> 'codi';

  verdict := CASE
    WHEN unresolved_sanction > 0 THEN 'has_unresolved_sanctions'
    WHEN unserved_service > 0    THEN 'has_unserved_sanctions'
    WHEN pending_count > 0       THEN 'has_pending_cases'
    ELSE 'clear'
  END;

  RETURN jsonb_build_object(
    'result',                verdict,
    'pending_cases',         pending_count,
    'unresolved_sanctions',  unresolved_sanction,
    'unsubmitted_apologies', unsubmitted_apology,
    'unserved_service',      unserved_service,
    'blocking_cases',        blocking_cases,
    'checked_at',            NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_student_clearance(UUID) TO authenticated;

ALTER TABLE public.clearance_requests DROP CONSTRAINT IF EXISTS clearance_requests_auto_check_result_check;
ALTER TABLE public.clearance_requests
  ADD CONSTRAINT clearance_requests_auto_check_result_check CHECK (
    auto_check_result IS NULL OR auto_check_result IN (
      'clear',
      'has_pending_cases',
      'has_unresolved_sanctions',
      'has_unserved_sanctions',
      'error'
    )
  );

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.community_service_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_appeals ENABLE ROW LEVEL SECURITY;

-- A student must be able to read what they were told to serve, and by when.
DROP POLICY IF EXISTS "student reads own service" ON public.community_service_assignments;
CREATE POLICY "student reads own service" ON public.community_service_assignments
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "staff reads service" ON public.community_service_assignments;
CREATE POLICY "staff reads service" ON public.community_service_assignments
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "osa manages service" ON public.community_service_assignments;
CREATE POLICY "osa manages service" ON public.community_service_assignments
  FOR ALL USING (public.is_osa_staff()) WITH CHECK (public.is_osa_staff());

-- The appeal window is the student's own deadline; hiding it would be perverse.
DROP POLICY IF EXISTS "student reads own appeals" ON public.case_appeals;
CREATE POLICY "student reads own appeals" ON public.case_appeals
  FOR SELECT USING (
    case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

DROP POLICY IF EXISTS "staff reads appeals" ON public.case_appeals;
CREATE POLICY "staff reads appeals" ON public.case_appeals
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "osa manages appeals" ON public.case_appeals;
CREATE POLICY "osa manages appeals" ON public.case_appeals
  FOR ALL USING (public.is_osa_staff()) WITH CHECK (public.is_osa_staff());

-- ------------------------------------------------------------
-- 6. REALTIME
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['community_service_assignments', 'case_appeals']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.community_service_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.case_appeals REPLICA IDENTITY FULL;

COMMENT ON TABLE public.community_service_assignments IS
  'Second and third rungs of the minor-offense ladder (Table of Offenses). count_basis records which reading of the offense count was used, since the handbook does not say.';
COMMENT ON TABLE public.case_appeals IS
  'Appeals under Rules on Discipline Sec. 9. Filed outside the OSA; tracked here for the 10-day window and the outcome.';
