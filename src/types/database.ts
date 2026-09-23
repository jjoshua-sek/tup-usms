/**
 * Supabase client type parameter.
 *
 * ARCHITECTURAL NOTE
 * The OSA schema spans ~28 tables. Rather than hand-maintain a full
 * generated-style `Database` interface (which drifts the moment a
 * migration lands and produces `never` types when it does), this file
 * declares a permissive shape and application code reads rows through the
 * hand-written domain types in `src/types/osa.ts`.
 *
 * That split is deliberate:
 *   • `osa.ts` types are what developers actually work with — precise,
 *     well-named, documented.
 *   • This file only needs to satisfy the Supabase client generic.
 *
 * When you are ready to move to fully generated types:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 * and the `as` casts at query sites can be removed.
 */

import type { NotificationEntityType, NotificationType } from "@/lib/notifications/policy";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Permissive table shape. Row/Insert/Update are intentionally loose so that
 * `.select()`, `.insert()`, and `.update()` accept the domain types from
 * `osa.ts` without requiring a cast at every call site.
 */
interface GenericTable {
  Row: Record<string, any>;
  Insert: Record<string, any>;
  Update: Record<string, any>;
  Relationships: [];
}

interface GenericView {
  Row: Record<string, any>;
  Relationships: [];
}

/** Every table in the OSA schema, for editor autocomplete on `.from()`. */
export type OsaTableName =
  // Identity (retained from the original schema)
  | "students"
  | "staff"
  | "student_files"
  | "messages"
  | "audit_logs"
  | "calendar_events"
  | "concerns"
  | "concern_responses"
  // Discipline (00007)
  | "violation_types"
  | "violation_cases"
  | "case_timeline"
  | "case_documents"
  | "case_hearings"
  | "apology_letters"
  | "case_settlements"
  | "case_escalations"
  // Scheduling (00008)
  | "availability_blocks"
  | "hearing_slot_proposals"
  | "scheduling_config"
  // Scholarships (00009)
  | "scholarships"
  | "scholarship_criteria"
  | "scholarship_requirements"
  | "scholarship_eligibility_results"
  | "scholarship_applications"
  | "scholarship_masterlist_entries"
  // Clearance & ID (00010)
  | "clearance_requests"
  | "clearance_holds"
  | "id_validations"
  | "id_validation_scans"
  // ML Early Warning (00011)
  | "academic_documents"
  | "academic_snapshots"
  | "risk_model_versions"
  | "risk_assessments"
  | "risk_interventions"
  // Guidance & Notifications (00012)
  | "guidance_sessions"
  | "notifications"
  | "notification_preferences";

export type OsaViewName = "student_risk_features";

export interface Database {
  public: {
    Tables: Record<OsaTableName, GenericTable> & Record<string, GenericTable>;
    Views: Record<OsaViewName, GenericView> & Record<string, GenericView>;
    Functions: {
      /** Replaces the manual logbook search for Good Moral verification. */
      check_student_clearance: {
        Args: { p_student_id: string };
        Returns: Json;
      };
      create_notification: {
        /** Same shape as CreateNotificationArgs in lib/supabase/loose.ts. */
        Args: {
          p_user_id: string;
          p_type: NotificationType;
          p_title: string;
          p_body: string;
          p_priority?: "low" | "normal" | "high" | "urgent";
          p_channels?: Array<"in_app" | "email">;
          p_action_url?: string;
          p_action_label?: string;
          p_entity_type?: NotificationEntityType;
          p_entity_id?: string;
        };
        Returns: string;
      };
      current_staff_id: { Args: Record<string, never>; Returns: string | null };
      current_student_id: { Args: Record<string, never>; Returns: string | null };
      current_staff_role: { Args: Record<string, never>; Returns: string | null };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_osa_staff: { Args: Record<string, never>; Returns: boolean };
      can_access_confidential: { Args: Record<string, never>; Returns: boolean };
      user_role: { Args: Record<string, never>; Returns: string };
    } & Record<string, { Args: any; Returns: any }>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================================
// Retained convenience aliases
// ============================================================
// Types for tables that survived the pivot. Everything OSA-specific lives
// in `src/types/osa.ts`.

export interface Student {
  id: string;
  user_id: string;
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_extension: string | null;
  birth_date: string;
  birth_place: string | null;
  gender: string;
  citizenship: string;
  religion: string | null;
  civil_status: string | null;
  height_cm: number | null;
  weight_lbs: number | null;
  lrn: string | null;
  cellphone: string | null;
  email_address: string;
  address_unit: string | null;
  address_street: string | null;
  address_barangay: string;
  address_city: string;
  address_province: string;
  address_zip: string;
  congressional_district: string | null;
  financial_support: string | null;
  sponsor_name: string | null;
  is_indigenous: boolean;
  is_pwd: boolean;
  is_listahan: boolean;
  campus: string;
  department: string;
  program: string;
  year_level: string;
  scholastic_status: string;
  qr_hash: string | null;
  photo_url: string | null;
  photo_is_provisional: boolean;
  dpa_consent: boolean;
  dpa_consent_date: string | null;
  profile_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  user_id: string;
  employee_id: string;
  full_name: string;
  department: string;
  position: string;
  office: string | null;
  /** OSA role driving queue visibility and permissions. */
  role_type: string;
  /** Gate for CODI matters — requires both this flag and an eligible role. */
  can_access_confidential: boolean;
  institutional_email: string | null;
  created_at: string;
}

export interface StudentFile {
  id: string;
  student_id: string;
  uploaded_by: string;
  file_name: string;
  file_path: string;
  file_category: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  subject_line: string;
  body_text: string;
  status: string;
  folder: string;
  is_batch: boolean;
  batch_filter: string | null;
  sent_at: string;
  read_at: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  start_date: string;
  end_date: string;
  created_by: string;
  created_at: string;
}

/**
 * Student-initiated help request. Retained from the prior schema and
 * repurposed: a `concern` is "I need help," while a `violation_case` is
 * "you have been reported." Keeping them separate preserves the AI
 * summarization work already built for concerns.
 */
export interface Concern {
  id: string;
  student_id: string;
  category: string;
  subject_line: string;
  body_text: string;
  ai_summary: string | null;
  urgency_level: string | null;
  suggested_dept: string | null;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConcernResponse {
  id: string;
  concern_id: string;
  responder_id: string;
  response_text: string;
  created_at: string;
}

// Re-export the OSA domain types so a single import works app-wide.
export type * from "./osa";
