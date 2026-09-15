-- ============================================================
-- Migration 00010: Clearance, Good Moral Certificate, ID Validation
-- ============================================================
-- Implements OSA process §2.3 and flowchart §3.2, plus the parts of
-- requirement #5 covering ID validation status and clearance status
-- ("and what to do if it's on hold").
--
-- THE CORE IMPROVEMENT over the current process: today an OSA staff
-- member manually searches physical logbooks to confirm a student has no
-- pending case before issuing a Good Moral Certificate. Because
-- violation_cases is now a queryable table, that lookup becomes a single
-- indexed query — which is exactly the "Integrated Clearance & Good Moral
-- Verification" opportunity the OSA document names.
--
-- The clearance_holds table is what makes requirement #5's "what to do if
-- it's on hold" answerable: every hold carries explicit resolution
-- instructions and, where relevant, a link to the blocking case.
-- ============================================================

-- ============================================================
-- 1. CLEARANCE REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clearance_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_number  TEXT UNIQUE,

  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  request_type    TEXT NOT NULL CHECK (request_type IN (
    'good_moral',            -- Certificate of Good Moral Character
    'graduation_clearance',  -- OSA sign-off for graduating students
    'transfer_clearance',    -- for students transferring out
    'general_clearance'      -- end-of-term clearance
  )),

  -- Why the student needs it — sponsors, employers, and other schools
  -- each require different wording on the certificate.
  purpose         TEXT,

  status          TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted',    -- student filed the request
    'verifying',    -- automated + staff record check running
    'on_hold',      -- blocked; see clearance_holds
    'cleared',      -- record check passed, awaiting fee
    'fee_pending',  -- student must settle at the Cashier
    'ready',        -- fee paid, certificate ready for release
    'issued',       -- released to the student
    'rejected',
    'cancelled'
  )),

  -- Result of the automated record check against violation_cases.
  -- Kept separate from status so we can show "the system found nothing,
  -- but a human still needs to confirm" — preserving the human-in-the-loop
  -- that the current paper process relies on.
  auto_check_result TEXT CHECK (auto_check_result IN (
    'clear', 'has_pending_cases', 'has_unresolved_sanctions', 'error'
  ) OR auto_check_result IS NULL),
  auto_checked_at TIMESTAMPTZ,
  auto_check_details JSONB,

  verified_by     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  verified_at     TIMESTAMPTZ,
  verification_notes TEXT,

  -- Fee settlement at the Cashier (flowchart §3.2 step)
  fee_amount      NUMERIC(10,2),
  fee_paid_at     TIMESTAMPTZ,
  or_number       TEXT,   -- official receipt number
  fee_confirmed_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,

  -- Issued certificate
  certificate_number TEXT UNIQUE,
  certificate_path   TEXT,   -- generated PDF in Supabase Storage
  issued_at       TIMESTAMPTZ,
  issued_by       UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  -- Good Moral certificates are conventionally valid for a limited window
  valid_until     DATE,

  rejection_reason TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A certificate cannot be issued without a recorded fee payment.
  CONSTRAINT issued_requires_payment CHECK (
    issued_at IS NULL OR fee_paid_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_clearance_student
  ON public.clearance_requests(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clearance_status
  ON public.clearance_requests(status);
CREATE INDEX IF NOT EXISTS idx_clearance_queue
  ON public.clearance_requests(created_at)
  WHERE status IN ('submitted', 'verifying', 'on_hold');

-- Request number: CLR-<year>-<sequence>
CREATE OR REPLACE FUNCTION public.generate_clearance_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yr TEXT := to_char(NOW(), 'YYYY');
  seq_val BIGINT;
BEGIN
  IF NEW.request_number IS NULL THEN
    SELECT COUNT(*) + 1 INTO seq_val
    FROM public.clearance_requests
    WHERE date_part('year', created_at) = date_part('year', NOW());
    NEW.request_number := 'CLR-' || yr || '-' || lpad(seq_val::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clearance_number ON public.clearance_requests;
CREATE TRIGGER trg_clearance_number
  BEFORE INSERT ON public.clearance_requests
  FOR EACH ROW EXECUTE FUNCTION public.generate_clearance_number();

DROP TRIGGER IF EXISTS trg_clearance_updated_at ON public.clearance_requests;
CREATE TRIGGER trg_clearance_updated_at
  BEFORE UPDATE ON public.clearance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 2. CLEARANCE HOLDS — "what to do if it's on hold"
-- ============================================================
-- Every hold must carry actionable instructions. The student-facing UI
-- renders resolution_instructions verbatim, so a student never sees a bare
-- "ON HOLD" with no path forward — which is the single biggest complaint
-- about the current manual process.
CREATE TABLE IF NOT EXISTS public.clearance_holds (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clearance_request_id  UUID NOT NULL
    REFERENCES public.clearance_requests(id) ON DELETE CASCADE,

  hold_reason           TEXT NOT NULL CHECK (hold_reason IN (
    'pending_violation_case',
    'unresolved_sanction',
    'unsubmitted_apology_letter',
    'unsigned_settlement',
    'unpaid_fee',
    'unreturned_item',       -- library book, lab equipment
    'missing_document',
    'incomplete_requirements',
    'other'
  )),

  -- Link to the specific blocker, so the UI can deep-link the student
  -- straight to the case or requirement they need to resolve.
  related_case_id       UUID REFERENCES public.violation_cases(id) ON DELETE SET NULL,

  description           TEXT NOT NULL,

  -- Plain-language, step-by-step. Required — a hold without instructions
  -- is not permitted to exist.
  resolution_instructions TEXT NOT NULL,

  -- Which office the student must visit.
  responsible_office    TEXT,

  placed_by             UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  placed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  resolved_by           UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  resolution_notes      TEXT
);

CREATE INDEX IF NOT EXISTS idx_holds_request
  ON public.clearance_holds(clearance_request_id);
CREATE INDEX IF NOT EXISTS idx_holds_active
  ON public.clearance_holds(clearance_request_id)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_holds_case
  ON public.clearance_holds(related_case_id) WHERE related_case_id IS NOT NULL;

-- ============================================================
-- 3. GOOD MORAL AUTO-CHECK FUNCTION
-- ============================================================
-- Replaces the manual logbook search. Returns a structured verdict that
-- the application writes into clearance_requests.auto_check_result.
--
-- SECURITY DEFINER because it must read violation_cases regardless of the
-- caller's RLS scope — a student invoking their own clearance check needs
-- the count of their blocking cases without being able to read the case
-- rows themselves.
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
  blocking_cases      JSONB;
  verdict             TEXT;
BEGIN
  -- Cases that are open and not yet resolved
  SELECT COUNT(*) INTO pending_count
  FROM public.violation_cases
  WHERE student_id = p_student_id
    AND status NOT IN ('closed', 'dismissed');

  -- Sanctions applied but the case never formally closed
  SELECT COUNT(*) INTO unresolved_sanction
  FROM public.violation_cases
  WHERE student_id = p_student_id
    AND status = 'sanctioned'
    AND closed_at IS NULL;

  -- Minor cases awaiting the student's apology letter
  SELECT COUNT(*) INTO unsubmitted_apology
  FROM public.violation_cases vc
  WHERE vc.student_id = p_student_id
    AND vc.status = 'awaiting_apology'
    AND NOT EXISTS (
      SELECT 1 FROM public.apology_letters al
      WHERE al.case_id = vc.id AND al.review_status = 'accepted'
    );

  -- Summarize the blockers for the UI. Confidential (CODI) cases are
  -- deliberately excluded from the detail payload: their existence would
  -- leak through a clearance screen that ordinary staff can see.
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
    WHEN pending_count > 0       THEN 'has_pending_cases'
    ELSE 'clear'
  END;

  RETURN jsonb_build_object(
    'result',                verdict,
    'pending_cases',         pending_count,
    'unresolved_sanctions',  unresolved_sanction,
    'unsubmitted_apologies', unsubmitted_apology,
    'blocking_cases',        blocking_cases,
    'checked_at',            NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_student_clearance(UUID) TO authenticated;

-- ============================================================
-- 4. ID VALIDATION
-- ============================================================
-- Requirement #5: students handle ID validation and see their validation
-- status. The OSA document also names "Unified ID Validation & Turnstile
-- Integration" as a target, which is why disciplinary status is linked
-- here: a student with an active grave sanction can have their ID
-- validation suspended, and campus entry points would honor that.
CREATE TABLE IF NOT EXISTS public.id_validations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  school_year     TEXT NOT NULL,
  semester        TEXT NOT NULL,

  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- student submitted for validation
    'under_review', -- OSA verifying photo + records
    'validated',    -- active and scannable
    'rejected',     -- photo or records issue; see rejection_reason
    'expired',      -- term ended
    'suspended',    -- disciplinary suspension of campus privileges
    'revoked'       -- lost/stolen ID reported
  )),

  -- Physical sticker or stamp number, for reconciliation with the paper
  -- process during the transition period.
  validation_sticker_number TEXT,

  -- Base secret for the rotating QR token (see src/app/(student)/id).
  -- Regenerated on revoke so an old ID's QR stops verifying.
  qr_secret       TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),

  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_by    UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  validated_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,

  rejection_reason TEXT,
  -- Populated when status = 'suspended', linking to the disciplinary cause
  suspension_case_id UUID REFERENCES public.violation_cases(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, school_year, semester)
);

CREATE INDEX IF NOT EXISTS idx_idval_student
  ON public.id_validations(student_id);
CREATE INDEX IF NOT EXISTS idx_idval_status
  ON public.id_validations(status);
-- One active validation per student is the common lookup for the scanner.
CREATE INDEX IF NOT EXISTS idx_idval_active
  ON public.id_validations(student_id)
  WHERE status = 'validated';

DROP TRIGGER IF EXISTS trg_idval_updated_at ON public.id_validations;
CREATE TRIGGER trg_idval_updated_at
  BEFORE UPDATE ON public.id_validations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 5. ID VALIDATION SCANS — audit trail for every scan
-- ============================================================
-- Append-only. Supports both the OSA scanner UI and any future turnstile
-- integration. Recording failed scans matters as much as successful ones:
-- a burst of failures on one student number is a signal of a cloned ID.
CREATE TABLE IF NOT EXISTS public.id_validation_scans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      UUID REFERENCES public.students(id) ON DELETE SET NULL,
  id_validation_id UUID REFERENCES public.id_validations(id) ON DELETE SET NULL,

  scanned_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scan_location   TEXT,   -- "Main Gate", "OSA Office", "Library"

  scan_result     TEXT NOT NULL CHECK (scan_result IN (
    'valid',
    'expired',
    'suspended',
    'revoked',
    'not_found',
    'token_expired',   -- rotating QR token outside its window
    'token_invalid'    -- HMAC mismatch: forged or tampered
  )),

  -- The raw token presented, retained for forensic review of failures.
  presented_token TEXT,
  notes           TEXT,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_student
  ON public.id_validation_scans(student_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_time
  ON public.id_validation_scans(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_failures
  ON public.id_validation_scans(scanned_at DESC)
  WHERE scan_result <> 'valid';
