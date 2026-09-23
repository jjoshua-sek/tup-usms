/**
 * Domain types for the OSA System.
 *
 * These are hand-maintained row shapes for the tables created in
 * migrations 00006–00013. They are intentionally separate from
 * `database.ts` (the Supabase client generic) so that application code has
 * clean, well-named types to work with regardless of how the generated
 * types evolve.
 *
 * To regenerate the Supabase client types after applying migrations:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 */

// ============================================================
// SHARED ENUMS
// ============================================================

export const STAFF_ROLES = [
  "osa_head",
  "osa_officer",
  "guidance_counselor",
  "faculty",
  "pic_member",
  "sdb_member",
  "codi_member",
  "registrar",
  "cashier",
  "security_guard",
  "admin",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  osa_head: "OSA Head",
  osa_officer: "OSA Officer",
  guidance_counselor: "Guidance Counselor",
  faculty: "Faculty",
  pic_member: "PIC Member",
  sdb_member: "SDB Member",
  codi_member: "CODI Member",
  registrar: "Registrar",
  cashier: "Cashier",
  security_guard: "Security Guard",
  admin: "Administrator",
};

export type OffenseClassification = "minor" | "major" | "confidential";

export const CASE_STATUSES = [
  "filed",
  "under_review",
  "counselling_scheduled",
  "awaiting_apology",
  "summons_sent",
  "hearing_scheduled",
  "hearing_completed",
  "in_mediation",
  "settled",
  "escalated_pic",
  "escalated_sdb",
  "referred_codi",
  "sanctioned",
  "dismissed",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * Display metadata per case status. `tone` drives badge colour; `isTerminal`
 * marks states that close a case out of the working queue.
 */
export const CASE_STATUS_META: Record<
  CaseStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger"; isTerminal: boolean }
> = {
  filed:                 { label: "Filed",              tone: "info",    isTerminal: false },
  under_review:          { label: "Under Review",       tone: "info",    isTerminal: false },
  counselling_scheduled: { label: "Counselling Set",    tone: "warning", isTerminal: false },
  awaiting_apology:      { label: "Awaiting Apology",   tone: "warning", isTerminal: false },
  summons_sent:          { label: "Summons Sent",       tone: "warning", isTerminal: false },
  hearing_scheduled:     { label: "Hearing Scheduled",  tone: "warning", isTerminal: false },
  hearing_completed:     { label: "Hearing Held",       tone: "info",    isTerminal: false },
  in_mediation:          { label: "In Mediation",       tone: "warning", isTerminal: false },
  settled:               { label: "Settled",            tone: "success", isTerminal: false },
  escalated_pic:         { label: "Escalated to PIC",   tone: "danger",  isTerminal: false },
  escalated_sdb:         { label: "Escalated to SDB",   tone: "danger",  isTerminal: false },
  referred_codi:         { label: "Referred to CODI",   tone: "danger",  isTerminal: false },
  sanctioned:            { label: "Sanctioned",         tone: "danger",  isTerminal: false },
  dismissed:             { label: "Dismissed",          tone: "neutral", isTerminal: true },
  closed:                { label: "Closed",             tone: "neutral", isTerminal: true },
};

export type ResolutionPath =
  | "counselling_apology"
  | "mediation_settlement"
  | "pic_sdb"
  | "codi_referral"
  | "dismissed";

export type Confidentiality = "normal" | "restricted" | "codi";

export const HEARING_STATUSES = [
  "awaiting_complainant",
  "complainant_approved",
  "student_notified",
  "student_acknowledged",
  "confirmed",
  "completed",
  "rescheduled",
  "cancelled",
  "no_show_student",
  "no_show_complainant",
] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];

export const HEARING_STATUS_LABELS: Record<HearingStatus, string> = {
  awaiting_complainant: "Awaiting professor approval",
  complainant_approved: "Approved — ready to notify student",
  student_notified: "Student notified",
  student_acknowledged: "Student acknowledged",
  confirmed: "Confirmed",
  completed: "Completed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  no_show_student: "Student did not attend",
  no_show_complainant: "Complainant did not attend",
};

export type RiskTier = "low" | "moderate" | "high" | "critical";

export type EligibilityStatus =
  | "eligible"
  | "partially_eligible"
  | "not_eligible"
  | "indeterminate";

export type ClearanceStatus =
  | "submitted"
  | "verifying"
  | "on_hold"
  | "cleared"
  | "fee_pending"
  | "ready"
  | "issued"
  | "rejected"
  | "cancelled";

export const CLEARANCE_STATUS_META: Record<
  ClearanceStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }
> = {
  submitted:   { label: "Submitted",    tone: "info" },
  verifying:   { label: "Verifying",    tone: "info" },
  on_hold:     { label: "On Hold",      tone: "danger" },
  cleared:     { label: "Cleared",      tone: "success" },
  fee_pending: { label: "Fee Pending",  tone: "warning" },
  ready:       { label: "Ready",        tone: "success" },
  issued:      { label: "Issued",       tone: "success" },
  rejected:    { label: "Rejected",     tone: "danger" },
  cancelled:   { label: "Cancelled",    tone: "neutral" },
};

export type IdValidationStatus =
  | "pending"
  | "under_review"
  | "validated"
  | "rejected"
  | "expired"
  | "suspended"
  | "revoked"
  /**
   * Handed in to the OSA before credentials are released on clearance
   * (Handbook, Application for Clearance). Distinct from 'revoked': the
   * student did nothing wrong, they graduated or transferred out.
   */
  | "surrendered";

export const ID_STATUS_META: Record<
  IdValidationStatus,
  { label: string; tone: "neutral" | "info" | "warning" | "success" | "danger" }
> = {
  pending:      { label: "Pending",      tone: "info" },
  under_review: { label: "Under Review", tone: "info" },
  validated:    { label: "Validated",    tone: "success" },
  rejected:     { label: "Rejected",     tone: "danger" },
  expired:      { label: "Expired",      tone: "warning" },
  suspended:    { label: "Suspended",    tone: "danger" },
  revoked:      { label: "Revoked",      tone: "danger" },
  surrendered:  { label: "Surrendered",  tone: "neutral" },
};

// ============================================================
// ROW TYPES — DISCIPLINE
// ============================================================

export interface ViolationType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_classification: OffenseClassification;
  handbook_reference: string | null;
  typical_sanction: string | null;
  auto_route_codi: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ViolationCase {
  id: string;
  case_number: string;
  student_id: string;
  complainant_staff_id: string | null;
  complainant_type: "faculty" | "staff" | "student" | "osa_initiated" | "external";
  complainant_name: string | null;
  violation_type_id: string | null;
  classification: OffenseClassification;
  incident_date: string;
  incident_time: string | null;
  incident_location: string | null;
  description: string;
  status: CaseStatus;
  resolution_path: ResolutionPath | null;
  confidentiality: Confidentiality;
  assigned_officer_id: string | null;
  sanction_applied: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

/** Case joined with the display fields the UI needs most often. */
export interface ViolationCaseWithRelations extends ViolationCase {
  students?: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
    year_level: string | null;
  } | null;
  violation_types?: Pick<ViolationType, "code" | "name" | "default_classification"> | null;
  complainant?: { full_name: string; position: string | null } | null;
  assigned_officer?: { full_name: string } | null;
}

export interface CaseTimelineEntry {
  id: string;
  case_id: string;
  actor_id: string | null;
  actor_label: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  occurred_at: string;
}

export interface CaseHearing {
  id: string;
  case_id: string;
  hearing_type:
    | "counselling"
    | "conference"
    | "mediation"
    | "pic_hearing"
    | "sdb_hearing"
    | "follow_up";
  scheduled_start: string;
  scheduled_end: string;
  venue: string;
  status: HearingStatus;
  proposed_by: "system" | "staff" | "complainant";
  complainant_approved_by: string | null;
  complainant_approved_at: string | null;
  student_notified_at: string | null;
  student_acknowledged_at: string | null;
  notified_via_email: boolean;
  notified_via_portal: boolean;
  meeting_notes: string | null;
  outcome:
    | "settled"
    | "escalated"
    | "apology_agreed"
    | "dismissed"
    | "follow_up_required"
    | "no_resolution"
    | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApologyLetter {
  id: string;
  case_id: string;
  student_id: string;
  letter_text: string | null;
  file_path: string | null;
  submitted_at: string;
  review_status: "pending" | "accepted" | "revision_requested" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_notes: string | null;
}

export interface CaseSettlement {
  id: string;
  case_id: string;
  hearing_id: string | null;
  terms: string;
  student_obligations: string | null;
  compliance_deadline: string | null;
  student_signed_at: string | null;
  complainant_signed_at: string | null;
  osa_witnessed_by: string | null;
  osa_witnessed_at: string | null;
  is_complied: boolean | null;
  complied_at: string | null;
  created_at: string;
}

export interface CaseEscalation {
  id: string;
  case_id: string;
  escalated_to: "PIC" | "SDB" | "CODI";
  escalated_by: string | null;
  reason: string;
  escalated_at: string;
  outcome:
    | "upheld"
    | "dismissed"
    | "referred_further"
    | "sanction_recommended"
    | "pending"
    | null;
  outcome_notes: string | null;
  sanction_recommended: string | null;
  decided_at: string | null;
  external_reference: string | null;
}

// ============================================================
// ROW TYPES — SCHEDULING
// ============================================================

export interface AvailabilityBlockRow {
  id: string;
  user_id: string;
  day_of_week: string | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  block_type: "busy" | "free";
  source: "manual" | "cor_import" | "hearing" | "system";
  label: string | null;
  school_year: string | null;
  semester: string | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface HearingSlotProposal {
  id: string;
  case_id: string;
  proposed_start: string;
  proposed_end: string;
  score: number;
  rationale: string | null;
  score_factors: Record<string, unknown> | null;
  rank: number;
  batch_id: string;
  status: "suggested" | "selected" | "rejected" | "superseded" | "expired";
  selected_by: string | null;
  selected_at: string | null;
  generated_at: string;
}

// ============================================================
// ROW TYPES — SCHOLARSHIPS
// ============================================================

export interface Scholarship {
  id: string;
  code: string;
  name: string;
  sponsor_name: string;
  funding_type: "government" | "private" | "institutional";
  description: string | null;
  benefit_summary: string | null;
  is_masterlist_based: boolean;
  slots_available: number | null;
  slots_filled: number;
  application_opens: string | null;
  application_closes: string | null;
  moa_reference: string | null;
  contact_person: string | null;
  contact_email: string | null;
  external_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScholarshipEligibilityResultRow {
  id: string;
  student_id: string;
  scholarship_id: string;
  eligibility_status: EligibilityStatus;
  passed_criteria: unknown[];
  failed_criteria: unknown[];
  missing_data: unknown[];
  match_percentage: number | null;
  computed_at: string;
}

export interface ScholarshipApplication {
  id: string;
  student_id: string;
  scholarship_id: string;
  status:
    | "interest_declared"
    | "documents_pending"
    | "documents_complete"
    | "under_review"
    | "endorsed"
    | "forwarded"
    | "awarded"
    | "rejected"
    | "withdrawn";
  school_year: string;
  semester: string | null;
  eligibility_snapshot: Record<string, unknown> | null;
  requirements_status: unknown[];
  endorsed_by: string | null;
  endorsed_at: string | null;
  endorsement_notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ROW TYPES — CLEARANCE & ID
// ============================================================

export interface ClearanceRequest {
  id: string;
  request_number: string;
  student_id: string;
  request_type:
    | "good_moral"
    | "graduation_clearance"
    | "transfer_clearance"
    | "general_clearance";
  purpose: string | null;
  status: ClearanceStatus;
  auto_check_result:
    | "clear"
    | "has_pending_cases"
    | "has_unresolved_sanctions"
    | "error"
    | null;
  auto_checked_at: string | null;
  auto_check_details: Record<string, unknown> | null;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  fee_amount: number | null;
  fee_paid_at: string | null;
  or_number: string | null;
  fee_confirmed_by: string | null;
  certificate_number: string | null;
  certificate_path: string | null;
  issued_at: string | null;
  issued_by: string | null;
  valid_until: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClearanceHold {
  id: string;
  clearance_request_id: string;
  hold_reason:
    | "pending_violation_case"
    | "unresolved_sanction"
    | "unsubmitted_apology_letter"
    | "unsigned_settlement"
    | "unpaid_fee"
    | "unreturned_item"
    | "missing_document"
    | "incomplete_requirements"
    | "other";
  related_case_id: string | null;
  description: string;
  resolution_instructions: string;
  responsible_office: string | null;
  placed_by: string | null;
  placed_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

export interface IdValidation {
  id: string;
  student_id: string;
  school_year: string;
  semester: string;
  status: IdValidationStatus;
  validation_sticker_number: string | null;
  qr_secret: string;
  submitted_at: string;
  validated_by: string | null;
  validated_at: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  suspension_case_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ROW TYPES — ML EARLY WARNING
// ============================================================

export interface AcademicDocument {
  id: string;
  student_id: string;
  document_type: "certificate_of_registration" | "rating_slip" | "transcript";
  school_year: string;
  semester: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  processing_status:
    | "uploaded"
    | "extracting"
    | "extracted"
    | "verification_failed"
    | "verified"
    | "rejected";
  extracted_data: ExtractedAcademicData | null;
  extraction_confidence: number | null;
  extraction_model: string | null;
  extracted_at: string | null;
  extraction_error: string | null;
  verified_by: string | null;
  verified_at: string | null;
  corrected_data: ExtractedAcademicData | null;
  verification_notes: string | null;
  rejection_reason: string | null;
  uploaded_at: string;
}

/**
 * Shape produced by the Claude Vision extraction step.
 * Every field is optional: the model reports only what it can actually
 * read from the document, and a rating slip carries different fields than
 * a Certificate of Registration.
 */
export interface ExtractedAcademicData {
  student_number?: string;
  student_name?: string;
  school_year?: string;
  semester?: string;
  program?: string;
  year_level?: string;
  gwa?: number;
  units_enrolled?: number;
  units_passed?: number;
  units_failed?: number;
  scholastic_status?: string;
  subjects?: Array<{
    subject_code?: string;
    description?: string;
    units?: number;
    grade?: number | string;
    /** Present on a Certificate of Registration, absent on a rating slip. */
    schedule?: Array<{
      day_of_week?: string;
      start_time?: string;
      end_time?: string;
      room?: string;
    }>;
  }>;
  /** Per-field confidence, when the model can report it. */
  field_confidence?: Record<string, number>;
}

export interface AcademicSnapshot {
  id: string;
  student_id: string;
  school_year: string;
  semester: string;
  term_sequence: number;
  gwa: number | null;
  units_enrolled: number | null;
  units_passed: number | null;
  units_failed: number | null;
  units_dropped: number | null;
  subjects_enrolled: number | null;
  subjects_failed: number | null;
  attendance_rate: number | null;
  scholastic_status: string | null;
  subject_grades: unknown | null;
  source_document_id: string | null;
  data_source: "document_extraction" | "manual_entry" | "registrar_import";
  created_at: string;
  updated_at: string;
}

export interface RiskAssessmentRow {
  id: string;
  student_id: string;
  model_version_id: string;
  risk_score: number;
  risk_tier: RiskTier;
  feature_values: Record<string, unknown>;
  feature_contributions: Record<string, unknown>;
  top_risk_factors: unknown[];
  protective_factors: unknown[];
  ai_narrative: string | null;
  ai_recommended_actions: unknown[] | null;
  narrative_generated_at: string | null;
  data_completeness: number | null;
  is_current: boolean;
  trigger_reason: string | null;
  staff_override_tier: RiskTier | null;
  staff_override_reason: string | null;
  staff_override_by: string | null;
  staff_override_at: string | null;
  assessed_at: string;
}

export interface RiskIntervention {
  id: string;
  student_id: string;
  risk_assessment_id: string | null;
  intervention_type: string;
  rationale: string | null;
  status:
    | "recommended"
    | "approved"
    | "scheduled"
    | "in_progress"
    | "completed"
    | "declined"
    | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_to: string | null;
  scheduled_for: string | null;
  notes: string | null;
  outcome: string | null;
  outcome_rating: "improved" | "no_change" | "worsened" | "inconclusive" | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ROW TYPES — GUIDANCE & NOTIFICATIONS
// ============================================================

export interface GuidanceSession {
  id: string;
  student_id: string;
  counselor_id: string;
  session_type:
    | "walk_in"
    | "scheduled"
    | "referral"
    | "risk_intervention"
    | "disciplinary"
    | "follow_up"
    | "crisis";
  related_case_id: string | null;
  related_intervention_id: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  status: "scheduled" | "completed" | "no_show" | "cancelled" | "rescheduled";
  presenting_concern: string | null;
  concern_category: string | null;
  summary: string | null;
  confidential_notes: string | null;
  action_items: string | null;
  referral_made_to: string | null;
  follow_up_required: boolean;
  follow_up_date: string | null;
  confidentiality: "restricted" | "counselor_only";
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  notification_type: string;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  channels: string[];
  is_read: boolean;
  read_at: string | null;
  email_status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  email_recipient: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  expires_at: string | null;
  created_at: string;
}

// ============================================================
// VIEW TYPE
// ============================================================

/** Row shape of the `student_risk_features` view. */
export interface StudentRiskFeaturesRow {
  student_id: string;
  student_number: string | null;
  first_name: string | null;
  last_name: string | null;
  program: string | null;
  year_level: string | null;
  scholastic_status: string | null;
  current_gwa: number | null;
  current_units_enrolled: number | null;
  current_units_failed: number | null;
  current_attendance_rate: number | null;
  latest_term_sequence: number | null;
  previous_gwa: number | null;
  gwa_delta: number | null;
  failure_ratio: number | null;
  minor_violation_count: number | null;
  major_violation_count: number | null;
  open_case_count: number | null;
  days_since_last_violation: number | null;
  is_listahan: boolean | null;
  is_pwd: boolean | null;
  is_indigenous: boolean | null;
  financial_support: string | null;
  data_completeness: number | null;
}
