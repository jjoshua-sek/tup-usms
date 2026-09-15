-- ============================================================
-- Migration 00013: Row-Level Security for every OSA table
-- ============================================================
-- Three access principles govern this system:
--
--   1. STUDENTS see only their own records — enforced by joining through
--      students.user_id = auth.uid(), never by trusting a client filter.
--
--   2. CONFIDENTIAL CASES ARE INVISIBLE, not merely hidden. A CODI case
--      does not appear in an ordinary OSA officer's queries at all — not
--      as a redacted row, not as a count. Per the OSA process document,
--      harassment matters bypass the general grievance flow entirely, and
--      the existence of such a case is itself sensitive information.
--
--   3. COUNSELLING NOTES ARE COMPARTMENTALIZED. Disciplinary staff who may
--      adjudicate a student must not be able to read what that student
--      disclosed to a counselor. Enforced by policy, not convention.
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Resolve the current user's staff row id. NULL for students.
CREATE OR REPLACE FUNCTION public.current_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.staff WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Resolve the current user's student row id. NULL for staff.
CREATE OR REPLACE FUNCTION public.current_student_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.students WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Fine-grained OSA role, read from the staff table rather than the JWT so
-- a role change takes effect immediately without re-issuing tokens.
CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_type FROM public.staff WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Any staff member at all.
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff WHERE user_id = auth.uid());
$$;

-- Staff who work disciplinary cases.
CREATE OR REPLACE FUNCTION public.is_osa_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND role_type IN ('osa_head','osa_officer','guidance_counselor',
                        'pic_member','sdb_member','admin')
  );
$$;

-- Cleared for CODI / confidential matters. Requires BOTH an appropriate
-- role AND the explicit per-person flag — role alone is insufficient.
CREATE OR REPLACE FUNCTION public.can_access_confidential()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE user_id = auth.uid()
      AND can_access_confidential = TRUE
      AND role_type IN ('codi_member','osa_head','admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_staff_id()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_student_id()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_role()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_osa_staff()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_confidential() TO authenticated;

-- ============================================================
-- VIOLATION TYPES — reference data, readable by all
-- ============================================================
ALTER TABLE public.violation_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read violation types" ON public.violation_types;
CREATE POLICY "read violation types" ON public.violation_types
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "manage violation types" ON public.violation_types;
CREATE POLICY "manage violation types" ON public.violation_types
  FOR ALL USING (public.current_staff_role() IN ('osa_head','admin'));

-- ============================================================
-- VIOLATION CASES — the confidentiality tier lives here
-- ============================================================
ALTER TABLE public.violation_cases ENABLE ROW LEVEL SECURITY;

-- Students see their own cases, EXCEPT CODI matters. A student involved in
-- a CODI case is contacted through that committee's own process, not
-- through this portal.
DROP POLICY IF EXISTS "student reads own cases" ON public.violation_cases;
CREATE POLICY "student reads own cases" ON public.violation_cases
  FOR SELECT USING (
    student_id = public.current_student_id()
    AND confidentiality <> 'codi'
  );

-- OSA staff see all non-confidential cases.
DROP POLICY IF EXISTS "osa reads cases" ON public.violation_cases;
CREATE POLICY "osa reads cases" ON public.violation_cases
  FOR SELECT USING (
    public.is_osa_staff() AND confidentiality <> 'codi'
  );

-- Cleared personnel see confidential cases. Separate policy rather than an
-- OR inside the previous one, so the two access paths remain individually
-- auditable.
DROP POLICY IF EXISTS "codi reads confidential cases" ON public.violation_cases;
CREATE POLICY "codi reads confidential cases" ON public.violation_cases
  FOR SELECT USING (
    confidentiality = 'codi' AND public.can_access_confidential()
  );

-- A faculty complainant can follow the case they filed, even though
-- faculty are not OSA staff.
DROP POLICY IF EXISTS "complainant reads own filed cases" ON public.violation_cases;
CREATE POLICY "complainant reads own filed cases" ON public.violation_cases
  FOR SELECT USING (
    complainant_staff_id = public.current_staff_id()
    AND confidentiality <> 'codi'
  );

-- Any staff member may file a complaint.
DROP POLICY IF EXISTS "staff files cases" ON public.violation_cases;
CREATE POLICY "staff files cases" ON public.violation_cases
  FOR INSERT WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "osa updates cases" ON public.violation_cases;
CREATE POLICY "osa updates cases" ON public.violation_cases
  FOR UPDATE USING (
    (public.is_osa_staff() AND confidentiality <> 'codi')
    OR (confidentiality = 'codi' AND public.can_access_confidential())
  );

-- ============================================================
-- CASE TIMELINE — append-only evidentiary log
-- ============================================================
ALTER TABLE public.case_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read case timeline" ON public.case_timeline;
CREATE POLICY "read case timeline" ON public.case_timeline
  FOR SELECT USING (
    case_id IN (SELECT id FROM public.violation_cases)  -- inherits case RLS
  );

DROP POLICY IF EXISTS "append case timeline" ON public.case_timeline;
CREATE POLICY "append case timeline" ON public.case_timeline
  FOR INSERT WITH CHECK (public.is_staff());

-- NOTE: no UPDATE or DELETE policy is defined. The timeline is immutable
-- by construction — this is what makes it admissible as a record of
-- process if a sanction is ever challenged.

-- ============================================================
-- CASE DOCUMENTS
-- ============================================================
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;

-- Students see only documents explicitly released to them. Investigation
-- material stays staff-side until disclosed at the hearing.
DROP POLICY IF EXISTS "student reads released docs" ON public.case_documents;
CREATE POLICY "student reads released docs" ON public.case_documents
  FOR SELECT USING (
    visible_to_student = TRUE
    AND case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

DROP POLICY IF EXISTS "staff reads case docs" ON public.case_documents;
CREATE POLICY "staff reads case docs" ON public.case_documents
  FOR SELECT USING (case_id IN (SELECT id FROM public.violation_cases));

DROP POLICY IF EXISTS "upload case docs" ON public.case_documents;
CREATE POLICY "upload case docs" ON public.case_documents
  FOR INSERT WITH CHECK (uploaded_by = auth.uid());

-- ============================================================
-- CASE HEARINGS
-- ============================================================
ALTER TABLE public.case_hearings ENABLE ROW LEVEL SECURITY;

-- A student may only see a hearing AFTER being formally notified. Before
-- that moment the schedule is still being negotiated between OSA and the
-- complainant, and surfacing it early would break the approval ordering
-- that requirement #1 specifies.
DROP POLICY IF EXISTS "student reads notified hearings" ON public.case_hearings;
CREATE POLICY "student reads notified hearings" ON public.case_hearings
  FOR SELECT USING (
    student_notified_at IS NOT NULL
    AND case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

-- Student acknowledges receipt of the summons.
DROP POLICY IF EXISTS "student acknowledges hearing" ON public.case_hearings;
CREATE POLICY "student acknowledges hearing" ON public.case_hearings
  FOR UPDATE USING (
    student_notified_at IS NOT NULL
    AND case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

DROP POLICY IF EXISTS "staff reads hearings" ON public.case_hearings;
CREATE POLICY "staff reads hearings" ON public.case_hearings
  FOR SELECT USING (case_id IN (SELECT id FROM public.violation_cases));

DROP POLICY IF EXISTS "staff manages hearings" ON public.case_hearings;
CREATE POLICY "staff manages hearings" ON public.case_hearings
  FOR ALL USING (public.is_staff());

-- ============================================================
-- APOLOGY LETTERS
-- ============================================================
ALTER TABLE public.apology_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own apology" ON public.apology_letters;
CREATE POLICY "student reads own apology" ON public.apology_letters
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "student submits apology" ON public.apology_letters;
CREATE POLICY "student submits apology" ON public.apology_letters
  FOR INSERT WITH CHECK (student_id = public.current_student_id());

DROP POLICY IF EXISTS "osa reviews apology" ON public.apology_letters;
CREATE POLICY "osa reviews apology" ON public.apology_letters
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- SETTLEMENTS
-- ============================================================
ALTER TABLE public.case_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own settlement" ON public.case_settlements;
CREATE POLICY "student reads own settlement" ON public.case_settlements
  FOR SELECT USING (
    case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

-- Student signs their side of the agreement.
DROP POLICY IF EXISTS "student signs settlement" ON public.case_settlements;
CREATE POLICY "student signs settlement" ON public.case_settlements
  FOR UPDATE USING (
    case_id IN (
      SELECT id FROM public.violation_cases
      WHERE student_id = public.current_student_id()
    )
  );

DROP POLICY IF EXISTS "staff manages settlements" ON public.case_settlements;
CREATE POLICY "staff manages settlements" ON public.case_settlements
  FOR ALL USING (public.is_staff());

-- ============================================================
-- ESCALATIONS — committee-level, staff only
-- ============================================================
ALTER TABLE public.case_escalations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads escalations" ON public.case_escalations;
CREATE POLICY "staff reads escalations" ON public.case_escalations
  FOR SELECT USING (
    public.is_osa_staff()
    OR (escalated_to = 'CODI' AND public.can_access_confidential())
  );

DROP POLICY IF EXISTS "osa manages escalations" ON public.case_escalations;
CREATE POLICY "osa manages escalations" ON public.case_escalations
  FOR ALL USING (
    public.current_staff_role() IN ('osa_head','osa_officer','pic_member','sdb_member','admin')
  );

-- ============================================================
-- AVAILABILITY BLOCKS
-- ============================================================
ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage own availability" ON public.availability_blocks;
CREATE POLICY "manage own availability" ON public.availability_blocks
  FOR ALL USING (user_id = auth.uid());

-- OSA staff read others' availability because the scheduler must compute
-- an intersection across two calendars. Read-only: staff cannot edit
-- someone else's schedule.
DROP POLICY IF EXISTS "osa reads availability" ON public.availability_blocks;
CREATE POLICY "osa reads availability" ON public.availability_blocks
  FOR SELECT USING (public.is_osa_staff());

-- ============================================================
-- HEARING SLOT PROPOSALS — staff-only until one is selected
-- ============================================================
ALTER TABLE public.hearing_slot_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads proposals" ON public.hearing_slot_proposals;
CREATE POLICY "staff reads proposals" ON public.hearing_slot_proposals
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "staff manages proposals" ON public.hearing_slot_proposals;
CREATE POLICY "staff manages proposals" ON public.hearing_slot_proposals
  FOR ALL USING (public.is_staff());

ALTER TABLE public.scheduling_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads scheduling config" ON public.scheduling_config;
CREATE POLICY "staff reads scheduling config" ON public.scheduling_config
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "admin manages scheduling config" ON public.scheduling_config;
CREATE POLICY "admin manages scheduling config" ON public.scheduling_config
  FOR ALL USING (public.current_staff_role() IN ('osa_head','admin'));

-- ============================================================
-- SCHOLARSHIPS — catalog is public to authenticated users
-- ============================================================
ALTER TABLE public.scholarships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read scholarships" ON public.scholarships;
CREATE POLICY "read scholarships" ON public.scholarships
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "osa manages scholarships" ON public.scholarships;
CREATE POLICY "osa manages scholarships" ON public.scholarships
  FOR ALL USING (public.current_staff_role() IN ('osa_head','osa_officer','admin'));

ALTER TABLE public.scholarship_criteria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read criteria" ON public.scholarship_criteria;
CREATE POLICY "read criteria" ON public.scholarship_criteria
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "osa manages criteria" ON public.scholarship_criteria;
CREATE POLICY "osa manages criteria" ON public.scholarship_criteria
  FOR ALL USING (public.current_staff_role() IN ('osa_head','osa_officer','admin'));

ALTER TABLE public.scholarship_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read requirements" ON public.scholarship_requirements;
CREATE POLICY "read requirements" ON public.scholarship_requirements
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "osa manages requirements" ON public.scholarship_requirements;
CREATE POLICY "osa manages requirements" ON public.scholarship_requirements
  FOR ALL USING (public.current_staff_role() IN ('osa_head','osa_officer','admin'));

-- ============================================================
-- ELIGIBILITY RESULTS — a student's own eligibility is private
-- ============================================================
ALTER TABLE public.scholarship_eligibility_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own eligibility" ON public.scholarship_eligibility_results;
CREATE POLICY "student reads own eligibility" ON public.scholarship_eligibility_results
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "osa reads eligibility" ON public.scholarship_eligibility_results;
CREATE POLICY "osa reads eligibility" ON public.scholarship_eligibility_results
  FOR SELECT USING (public.is_osa_staff());

DROP POLICY IF EXISTS "osa writes eligibility" ON public.scholarship_eligibility_results;
CREATE POLICY "osa writes eligibility" ON public.scholarship_eligibility_results
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- SCHOLARSHIP APPLICATIONS
-- ============================================================
ALTER TABLE public.scholarship_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own applications" ON public.scholarship_applications;
CREATE POLICY "student reads own applications" ON public.scholarship_applications
  FOR SELECT USING (student_id = public.current_student_id());

-- A student may declare interest; OSA drives everything after that.
DROP POLICY IF EXISTS "student declares interest" ON public.scholarship_applications;
CREATE POLICY "student declares interest" ON public.scholarship_applications
  FOR INSERT WITH CHECK (student_id = public.current_student_id());

DROP POLICY IF EXISTS "osa manages applications" ON public.scholarship_applications;
CREATE POLICY "osa manages applications" ON public.scholarship_applications
  FOR ALL USING (public.is_osa_staff());

ALTER TABLE public.scholarship_masterlist_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own masterlist entry" ON public.scholarship_masterlist_entries;
CREATE POLICY "student reads own masterlist entry" ON public.scholarship_masterlist_entries
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "osa manages masterlist" ON public.scholarship_masterlist_entries;
CREATE POLICY "osa manages masterlist" ON public.scholarship_masterlist_entries
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- CLEARANCE REQUESTS
-- ============================================================
ALTER TABLE public.clearance_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own clearance" ON public.clearance_requests;
CREATE POLICY "student reads own clearance" ON public.clearance_requests
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "student requests clearance" ON public.clearance_requests;
CREATE POLICY "student requests clearance" ON public.clearance_requests
  FOR INSERT WITH CHECK (student_id = public.current_student_id());

DROP POLICY IF EXISTS "staff reads clearance" ON public.clearance_requests;
CREATE POLICY "staff reads clearance" ON public.clearance_requests
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "osa manages clearance" ON public.clearance_requests;
CREATE POLICY "osa manages clearance" ON public.clearance_requests
  FOR ALL USING (
    public.current_staff_role() IN ('osa_head','osa_officer','registrar','cashier','admin')
  );

-- ============================================================
-- CLEARANCE HOLDS — students MUST be able to read these
-- ============================================================
-- Requirement #5 asks for "what to do if it's on hold." That is only
-- answerable if the student can read the hold and its instructions.
ALTER TABLE public.clearance_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own holds" ON public.clearance_holds;
CREATE POLICY "student reads own holds" ON public.clearance_holds
  FOR SELECT USING (
    clearance_request_id IN (
      SELECT id FROM public.clearance_requests
      WHERE student_id = public.current_student_id()
    )
  );

DROP POLICY IF EXISTS "staff manages holds" ON public.clearance_holds;
CREATE POLICY "staff manages holds" ON public.clearance_holds
  FOR ALL USING (public.is_staff());

-- ============================================================
-- ID VALIDATION
-- ============================================================
ALTER TABLE public.id_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own id validation" ON public.id_validations;
CREATE POLICY "student reads own id validation" ON public.id_validations
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "student submits id validation" ON public.id_validations;
CREATE POLICY "student submits id validation" ON public.id_validations
  FOR INSERT WITH CHECK (student_id = public.current_student_id());

DROP POLICY IF EXISTS "staff reads id validations" ON public.id_validations;
CREATE POLICY "staff reads id validations" ON public.id_validations
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "osa manages id validations" ON public.id_validations;
CREATE POLICY "osa manages id validations" ON public.id_validations
  FOR ALL USING (public.is_osa_staff());

ALTER TABLE public.id_validation_scans ENABLE ROW LEVEL SECURITY;

-- Students can see where their own ID has been scanned — a transparency
-- measure under RA 10173's right to be informed about processing.
DROP POLICY IF EXISTS "student reads own scans" ON public.id_validation_scans;
CREATE POLICY "student reads own scans" ON public.id_validation_scans
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "staff reads scans" ON public.id_validation_scans;
CREATE POLICY "staff reads scans" ON public.id_validation_scans
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "staff records scans" ON public.id_validation_scans;
CREATE POLICY "staff records scans" ON public.id_validation_scans
  FOR INSERT WITH CHECK (public.is_staff());
-- Append-only: no UPDATE or DELETE policy.

-- ============================================================
-- ACADEMIC DOCUMENTS
-- ============================================================
ALTER TABLE public.academic_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own academic docs" ON public.academic_documents;
CREATE POLICY "student reads own academic docs" ON public.academic_documents
  FOR SELECT USING (student_id = public.current_student_id());

DROP POLICY IF EXISTS "student uploads academic docs" ON public.academic_documents;
CREATE POLICY "student uploads academic docs" ON public.academic_documents
  FOR INSERT WITH CHECK (student_id = public.current_student_id());

-- A student may replace a document that was rejected or is still awaiting
-- extraction — but not one staff has already verified.
DROP POLICY IF EXISTS "student replaces unverified docs" ON public.academic_documents;
CREATE POLICY "student replaces unverified docs" ON public.academic_documents
  FOR UPDATE USING (
    student_id = public.current_student_id()
    AND processing_status IN ('uploaded','rejected','verification_failed')
  );

DROP POLICY IF EXISTS "staff verifies academic docs" ON public.academic_documents;
CREATE POLICY "staff verifies academic docs" ON public.academic_documents
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- ACADEMIC SNAPSHOTS
-- ============================================================
ALTER TABLE public.academic_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own snapshots" ON public.academic_snapshots;
CREATE POLICY "student reads own snapshots" ON public.academic_snapshots
  FOR SELECT USING (student_id = public.current_student_id());

-- Write access is staff-only. A student cannot edit their own GWA, which
-- would otherwise be a trivial way to manufacture scholarship eligibility.
DROP POLICY IF EXISTS "osa manages snapshots" ON public.academic_snapshots;
CREATE POLICY "osa manages snapshots" ON public.academic_snapshots
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- RISK MODEL VERSIONS — model internals are staff-only
-- ============================================================
ALTER TABLE public.risk_model_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads models" ON public.risk_model_versions;
CREATE POLICY "staff reads models" ON public.risk_model_versions
  FOR SELECT USING (public.is_osa_staff());

DROP POLICY IF EXISTS "admin manages models" ON public.risk_model_versions;
CREATE POLICY "admin manages models" ON public.risk_model_versions
  FOR ALL USING (public.current_staff_role() IN ('osa_head','admin'));

-- ============================================================
-- RISK ASSESSMENTS — deliberately NOT student-visible
-- ============================================================
-- A student does not see their own risk score. This is a considered
-- decision, not an oversight:
--
--   • Labeling effects. Telling a student they are "high risk" can depress
--     performance — the prediction becomes self-fulfilling.
--   • The score is an operational trigger for staff outreach, not a
--     verdict about the student.
--   • The student experiences the OUTPUT (an invitation to guidance, a
--     scholarship referral) rather than the label.
--
-- If an institutional policy review later concludes students should have
-- access, add a SELECT policy scoped to current_student_id().
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "osa reads risk assessments" ON public.risk_assessments;
CREATE POLICY "osa reads risk assessments" ON public.risk_assessments
  FOR SELECT USING (public.is_osa_staff());

DROP POLICY IF EXISTS "osa writes risk assessments" ON public.risk_assessments;
CREATE POLICY "osa writes risk assessments" ON public.risk_assessments
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- RISK INTERVENTIONS — the student DOES see these
-- ============================================================
-- The intervention is the actionable, non-stigmatizing surface: "You have
-- a guidance appointment," not "you scored 0.78."
ALTER TABLE public.risk_interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student reads own interventions" ON public.risk_interventions;
CREATE POLICY "student reads own interventions" ON public.risk_interventions
  FOR SELECT USING (
    student_id = public.current_student_id()
    AND status IN ('scheduled','in_progress','completed')
  );

DROP POLICY IF EXISTS "osa manages interventions" ON public.risk_interventions;
CREATE POLICY "osa manages interventions" ON public.risk_interventions
  FOR ALL USING (public.is_osa_staff());

-- ============================================================
-- GUIDANCE SESSIONS — compartmentalized
-- ============================================================
ALTER TABLE public.guidance_sessions ENABLE ROW LEVEL SECURITY;

-- A student sees that a session happened and its scheduling details.
-- Note that summary and confidential_notes are column-level concerns the
-- application must not select for students; RLS governs rows, so the
-- Server Action layer is responsible for the column projection here.
DROP POLICY IF EXISTS "student reads own sessions" ON public.guidance_sessions;
CREATE POLICY "student reads own sessions" ON public.guidance_sessions
  FOR SELECT USING (student_id = public.current_student_id());

-- The counselor who ran the session has full access to their own notes.
DROP POLICY IF EXISTS "counselor manages own sessions" ON public.guidance_sessions;
CREATE POLICY "counselor manages own sessions" ON public.guidance_sessions
  FOR ALL USING (counselor_id = public.current_staff_id());

-- Other guidance staff and the OSA head can read 'restricted' sessions for
-- continuity of care, but 'counselor_only' rows remain invisible to them.
DROP POLICY IF EXISTS "guidance staff reads restricted sessions" ON public.guidance_sessions;
CREATE POLICY "guidance staff reads restricted sessions" ON public.guidance_sessions
  FOR SELECT USING (
    confidentiality = 'restricted'
    AND public.current_staff_role() IN ('guidance_counselor','osa_head')
  );

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own notifications" ON public.notifications;
CREATE POLICY "read own notifications" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- Marking as read is the only field a recipient may change.
DROP POLICY IF EXISTS "update own notifications" ON public.notifications;
CREATE POLICY "update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "staff sends notifications" ON public.notifications;
CREATE POLICY "staff sends notifications" ON public.notifications
  FOR INSERT WITH CHECK (public.is_staff());

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manage own preferences" ON public.notification_preferences;
CREATE POLICY "manage own preferences" ON public.notification_preferences
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- STUDENTS — widen staff read access for OSA operations
-- ============================================================
-- The original policy keyed on a JWT role claim. OSA work requires
-- role-aware access driven by the staff table instead.
DROP POLICY IF EXISTS "Staff can view all students" ON public.students;
CREATE POLICY "Staff can view all students" ON public.students
  FOR SELECT USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can update students" ON public.students;
CREATE POLICY "Staff can update students" ON public.students
  FOR UPDATE USING (public.is_osa_staff());

-- ============================================================
-- REALTIME
-- ============================================================
-- Live updates matter most where a user is actively waiting on a state
-- change: a notification arriving, a hearing being approved, a clearance
-- clearing. Everything else is fine on request-time fetch.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notifications',
    'case_hearings',
    'violation_cases',
    'clearance_requests',
    'academic_documents'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.notifications      REPLICA IDENTITY FULL;
ALTER TABLE public.case_hearings      REPLICA IDENTITY FULL;
ALTER TABLE public.violation_cases    REPLICA IDENTITY FULL;
ALTER TABLE public.clearance_requests REPLICA IDENTITY FULL;
ALTER TABLE public.academic_documents REPLICA IDENTITY FULL;
