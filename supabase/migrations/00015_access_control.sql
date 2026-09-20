-- ============================================================
-- 00015 — CAMPUS ACCESS CONTROL (QR TURNSTILE REACTIVATION)
-- ============================================================
-- Brings the university's existing QR turnstiles back into service.
--
-- Design decisions:
--   * The QR on both the physical TUP ID and the Digital ID encodes the
--     institutional student number (e.g. TUPM-22-0148). It is NOT a secret,
--     so security comes from server-side policy, not from the code itself:
--       - ID must be validated for the current term
--       - suspended / revoked / expired IDs are denied instantly
--       - anti-passback (entry after entry without an exit)
--       - concurrent use (same code at two gates within seconds)
--   * Gates authenticate with a per-device key (only its SHA-256 is stored).
--   * Every scan, allowed or denied, is appended to access_events.
--   * The rotating HMAC QR from 00010 is retired (see deprecation comments).
--
-- All writes to these tables happen through the service role
-- (/api/access/verify and staff Server Actions). RLS below only governs
-- what signed-in users can READ, plus anomaly review by OSA staff.
-- ============================================================

-- ------------------------------------------------------------
-- 1. SECURITY GUARD ROLE
-- ------------------------------------------------------------
-- The inline CHECK added in 00006 is auto-named staff_role_type_check.
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_role_type_check;
ALTER TABLE public.staff
  ADD CONSTRAINT staff_role_type_check CHECK (role_type IN (
    'osa_head',
    'osa_officer',
    'guidance_counselor',
    'faculty',
    'pic_member',
    'sdb_member',
    'codi_member',
    'registrar',
    'cashier',
    'security_guard',      -- Gate monitoring; sees live access feed only
    'admin'
  ));

-- ------------------------------------------------------------
-- 2. ROLE HELPERS
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND role_type IN ('osa_head', 'osa_officer', 'security_guard', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND role_type IN ('osa_head', 'osa_officer', 'admin')
  );
$$;

-- ------------------------------------------------------------
-- 3. ACCESS GATES — one row per kiosk / turnstile lane
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.access_gates (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code             TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  location         TEXT CHECK (location IS NULL OR char_length(location) <= 120),

  direction_mode   TEXT NOT NULL DEFAULT 'entry' CHECK (direction_mode IN (
    'entry', 'exit', 'bidirectional'
  )),

  -- monitor: log decisions but always open (safe rollout phase)
  -- enforce: denied scans keep the turnstile closed
  enforcement_mode TEXT NOT NULL DEFAULT 'monitor' CHECK (enforcement_mode IN (
    'monitor', 'enforce'
  )),

  -- off:  never checked
  -- soft: allowed but flagged as an anomaly
  -- hard: denied
  anti_passback    TEXT NOT NULL DEFAULT 'soft' CHECK (anti_passback IN (
    'off', 'soft', 'hard'
  )),

  -- How the kiosk browser pulses the turnstile relay.
  relay_mode       TEXT NOT NULL DEFAULT 'none' CHECK (relay_mode IN (
    'none', 'local_http', 'web_serial'
  )),
  relay_config     JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Device credential. The plaintext key is shown to staff exactly once.
  device_key_hash   TEXT UNIQUE,
  device_key_prefix TEXT,
  key_rotated_at    TIMESTAMPTZ,

  last_seen_at      TIMESTAMPTZ,
  last_seen_ip      TEXT,
  kiosk_user_agent  TEXT,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_access_gates_updated_at ON public.access_gates;
CREATE TRIGGER trg_access_gates_updated_at
  BEFORE UPDATE ON public.access_gates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 4. ACCESS EVENTS — append-only log of every scan
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.access_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  gate_id           UUID REFERENCES public.access_gates(id) ON DELETE SET NULL,
  -- Denormalized so history stays readable after a gate is renamed/removed.
  gate_label        TEXT NOT NULL,
  context           TEXT NOT NULL DEFAULT 'turnstile' CHECK (context IN (
    'turnstile', 'osa_desk'
  )),

  student_id        UUID REFERENCES public.students(id) ON DELETE SET NULL,
  id_validation_id  UUID REFERENCES public.id_validations(id) ON DELETE SET NULL,

  -- Raw scan (truncated) is kept for forensic review of unreadable codes.
  scanned_payload   TEXT CHECK (scanned_payload IS NULL OR char_length(scanned_payload) <= 64),
  normalized_student_number TEXT,

  direction         TEXT NOT NULL DEFAULT 'entry' CHECK (direction IN ('entry', 'exit')),

  -- decision   = what policy concluded
  -- enforced   = whether the gate honoured it (false in monitor mode)
  -- gate_opened = the physical outcome
  decision          TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  enforced          BOOLEAN NOT NULL DEFAULT TRUE,
  gate_opened       BOOLEAN NOT NULL DEFAULT FALSE,

  reason            TEXT NOT NULL CHECK (reason IN (
    'ok',
    'unreadable',      -- not a TUP student number
    'not_found',       -- well-formed but no such student
    'not_validated',   -- no validated ID for the current term
    'expired',
    'suspended',
    'revoked',
    'passback',        -- entry after entry without an exit
    'concurrent_use',  -- same ID at another gate moments ago
    'gate_inactive',
    'duplicate_scan'   -- re-scan within the debounce window
  )),

  latency_ms        INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  scanned_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_events_time
  ON public.access_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_student
  ON public.access_events(student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_gate
  ON public.access_events(gate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_number
  ON public.access_events(normalized_student_number, occurred_at DESC);
-- Hot path for anti-passback and concurrent-use checks.
CREATE INDEX IF NOT EXISTS idx_access_events_allowed_turnstile
  ON public.access_events(student_id, occurred_at DESC)
  WHERE decision = 'allow' AND context = 'turnstile';
CREATE INDEX IF NOT EXISTS idx_access_events_denials
  ON public.access_events(occurred_at DESC)
  WHERE decision = 'deny';

-- ------------------------------------------------------------
-- 5. ACCESS ANOMALIES — signals for human review
-- ------------------------------------------------------------
-- Anomalies never block anyone by themselves. OSA reviews them and, if
-- warranted, suspends the ID through the normal validation workflow.
CREATE TABLE IF NOT EXISTS public.access_anomalies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id        UUID REFERENCES public.students(id) ON DELETE CASCADE,
  normalized_student_number TEXT,

  anomaly_type      TEXT NOT NULL CHECK (anomaly_type IN (
    'concurrent_use',
    'passback_violation',
    'repeated_denials',
    'scan_while_suspended'
  )),
  severity          TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,

  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'reviewed', 'dismissed', 'confirmed'
  )),
  occurrence_count  INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),

  first_event_id    UUID REFERENCES public.access_events(id) ON DELETE SET NULL,
  last_event_id     UUID REFERENCES public.access_events(id) ON DELETE SET NULL,

  detected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  reviewed_by       UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT CHECK (review_notes IS NULL OR char_length(review_notes) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_access_anomalies_open
  ON public.access_anomalies(last_detected_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_access_anomalies_student
  ON public.access_anomalies(student_id, detected_at DESC);

-- Records an anomaly, folding repeats within 24h into one open row so the
-- review queue shows "concurrent use ×4" instead of four separate cards.
CREATE OR REPLACE FUNCTION public.record_access_anomaly(
  p_student_id     UUID,
  p_student_number TEXT,
  p_type           TEXT,
  p_severity       TEXT,
  p_details        JSONB,
  p_event_id       UUID
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE public.access_anomalies
     SET occurrence_count = occurrence_count + 1,
         last_detected_at = NOW(),
         last_event_id    = p_event_id,
         details          = details || COALESCE(p_details, '{}'::jsonb),
         severity = CASE
           WHEN severity = 'high' OR p_severity = 'high' THEN 'high'
           WHEN severity = 'medium' OR p_severity = 'medium' THEN 'medium'
           ELSE 'low'
         END
   WHERE status = 'open'
     AND anomaly_type = p_type
     AND last_detected_at > NOW() - INTERVAL '24 hours'
     AND (
       (p_student_id IS NOT NULL AND student_id = p_student_id)
       OR (p_student_id IS NULL AND student_id IS NULL
           AND normalized_student_number = p_student_number)
     )
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.access_anomalies (
      student_id, normalized_student_number, anomaly_type, severity,
      details, first_event_id, last_event_id
    ) VALUES (
      p_student_id, p_student_number, p_type, COALESCE(p_severity, 'medium'),
      COALESCE(p_details, '{}'::jsonb), p_event_id, p_event_id
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_access_anomaly(UUID, TEXT, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_access_anomaly(UUID, TEXT, TEXT, TEXT, JSONB, UUID)
  TO service_role;

-- ------------------------------------------------------------
-- 6. RETENTION (RA 10173 — proportionality / storage limitation)
-- ------------------------------------------------------------
-- Movement logs are personal data. Keep them only as long as needed.
-- Events tied to open or confirmed anomalies are kept as evidence.
-- Schedule with pg_cron if available:
--   SELECT cron.schedule('purge-access-events', '0 3 * * *',
--                        $$SELECT public.purge_access_events(180)$$);
CREATE OR REPLACE FUNCTION public.purge_access_events(p_days INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_days < 30 THEN
    RAISE EXCEPTION 'Retention window must be at least 30 days';
  END IF;

  DELETE FROM public.access_events e
   WHERE e.occurred_at < NOW() - make_interval(days => p_days)
     AND NOT EXISTS (
       SELECT 1 FROM public.access_anomalies a
        WHERE a.status IN ('open', 'confirmed')
          AND (a.first_event_id = e.id OR a.last_event_id = e.id)
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_access_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_access_events(INTEGER) TO service_role;

-- ------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.access_gates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access staff read gates" ON public.access_gates;
CREATE POLICY "access staff read gates" ON public.access_gates
  FOR SELECT USING (public.can_view_access());

DROP POLICY IF EXISTS "access managers manage gates" ON public.access_gates;
CREATE POLICY "access managers manage gates" ON public.access_gates
  FOR ALL USING (public.can_manage_access())
  WITH CHECK (public.can_manage_access());

-- Students see their own entry history (right to be informed).
DROP POLICY IF EXISTS "student reads own access events" ON public.access_events;
CREATE POLICY "student reads own access events" ON public.access_events
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "access staff read events" ON public.access_events;
CREATE POLICY "access staff read events" ON public.access_events
  FOR SELECT USING (public.can_view_access());
-- Append-only and service-role written: no INSERT/UPDATE/DELETE policies.

DROP POLICY IF EXISTS "access staff read anomalies" ON public.access_anomalies;
CREATE POLICY "access staff read anomalies" ON public.access_anomalies
  FOR SELECT USING (public.can_view_access());

DROP POLICY IF EXISTS "access managers review anomalies" ON public.access_anomalies;
CREATE POLICY "access managers review anomalies" ON public.access_anomalies
  FOR UPDATE USING (public.can_manage_access())
  WITH CHECK (public.can_manage_access());

-- ------------------------------------------------------------
-- 8. REALTIME — live gate feed on /staff/gates
-- ------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['access_events', 'access_anomalies', 'access_gates']
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

ALTER TABLE public.access_anomalies REPLICA IDENTITY FULL;
ALTER TABLE public.access_gates     REPLICA IDENTITY FULL;

-- ------------------------------------------------------------
-- 9. DEPRECATIONS
-- ------------------------------------------------------------
COMMENT ON TABLE public.id_validation_scans IS
  'DEPRECATED (00015): superseded by access_events. Kept read-only for historical records.';
COMMENT ON COLUMN public.id_validations.qr_secret IS
  'DEPRECATED (00015): rotating QR retired. ID QR now encodes the institutional student number.';
COMMENT ON COLUMN public.students.qr_hash IS
  'DEPRECATED (00015): unused. ID QR now encodes the institutional student number.';
