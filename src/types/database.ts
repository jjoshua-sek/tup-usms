/**
 * Supabase Database Type Definitions
 *
 * These types are auto-generated from the Supabase schema.
 * After running schema.sql, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * For now, these are manually maintained to match the ERD.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      students: {
        Row: {
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
          section: string | null;
          scholastic_status: string;
          qr_hash: string | null;
          photo_url: string | null;
          dpa_consent: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          student_number: string;
          last_name: string;
          first_name: string;
          middle_name?: string | null;
          name_extension?: string | null;
          birth_date: string;
          birth_place?: string | null;
          gender: string;
          citizenship?: string;
          religion?: string | null;
          civil_status?: string | null;
          height_cm?: number | null;
          weight_lbs?: number | null;
          lrn?: string | null;
          cellphone?: string | null;
          email_address: string;
          address_unit?: string | null;
          address_street?: string | null;
          address_barangay: string;
          address_city: string;
          address_province: string;
          address_zip: string;
          congressional_district?: string | null;
          financial_support?: string | null;
          sponsor_name?: string | null;
          is_indigenous?: boolean;
          is_pwd?: boolean;
          is_listahan?: boolean;
          campus: string;
          department: string;
          program: string;
          year_level: string;
          section?: string | null;
          scholastic_status?: string;
          qr_hash?: string | null;
          photo_url?: string | null;
          dpa_consent?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["students"]["Insert"]>;
      };
      staff: {
        Row: {
          id: string;
          user_id: string;
          employee_id: string;
          full_name: string;
          department: string;
          position: string;
          office: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          employee_id: string;
          full_name: string;
          department: string;
          position: string;
          office?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff"]["Insert"]>;
      };
      subjects: {
        Row: {
          id: string;
          subject_code: string;
          description: string;
          lec_units: number;
          lab_units: number;
          total_units: number;
          prerequisite: string | null;
          equiv_code: string | null;
          curriculum_year: string;
          semester: string;
          year_level: string;
        };
        Insert: {
          id?: string;
          subject_code: string;
          description: string;
          lec_units: number;
          lab_units: number;
          total_units: number;
          prerequisite?: string | null;
          equiv_code?: string | null;
          curriculum_year: string;
          semester: string;
          year_level: string;
        };
        Update: Partial<Database["public"]["Tables"]["subjects"]["Insert"]>;
      };
      sections: {
        Row: {
          id: string;
          section_code: string;
          program: string;
          year_level: string;
          semester: string;
          school_year: string;
        };
        Insert: {
          id?: string;
          section_code: string;
          program: string;
          year_level: string;
          semester: string;
          school_year: string;
        };
        Update: Partial<Database["public"]["Tables"]["sections"]["Insert"]>;
      };
      schedules: {
        Row: {
          id: string;
          subject_id: string;
          section_id: string;
          faculty_id: string;
          day_of_week: string;
          start_time: string;
          end_time: string;
          room: string;
          school_year: string;
          semester: string;
        };
        Insert: {
          id?: string;
          subject_id: string;
          section_id: string;
          faculty_id: string;
          day_of_week: string;
          start_time: string;
          end_time: string;
          room: string;
          school_year: string;
          semester: string;
        };
        Update: Partial<Database["public"]["Tables"]["schedules"]["Insert"]>;
      };
      enrollments: {
        Row: {
          id: string;
          student_id: string;
          subject_id: string;
          section_id: string;
          school_year: string;
          semester: string;
          status: string;
          grade: number | null;
          completion: string | null;
          enrolled_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          subject_id: string;
          section_id: string;
          school_year: string;
          semester: string;
          status?: string;
          grade?: number | null;
          completion?: string | null;
          enrolled_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["enrollments"]["Insert"]>;
      };
      academic_records: {
        Row: {
          id: string;
          student_id: string;
          school_year: string;
          semester: string;
          gpa: number;
          total_units: number;
          scholastic_status: string;
          admission_status: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          school_year: string;
          semester: string;
          gpa: number;
          total_units: number;
          scholastic_status: string;
          admission_status: string;
        };
        Update: Partial<Database["public"]["Tables"]["academic_records"]["Insert"]>;
      };
      concerns: {
        Row: {
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
        };
        Insert: {
          id?: string;
          student_id: string;
          category: string;
          subject_line: string;
          body_text: string;
          ai_summary?: string | null;
          urgency_level?: string | null;
          suggested_dept?: string | null;
          status?: string;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["concerns"]["Insert"]>;
      };
      concern_responses: {
        Row: {
          id: string;
          concern_id: string;
          responder_id: string;
          response_text: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          concern_id: string;
          responder_id: string;
          response_text: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["concern_responses"]["Insert"]>;
      };
      violations: {
        Row: {
          id: string;
          student_id: string;
          recorded_by: string;
          violation_type: string;
          description: string;
          severity: string;
          sanction: string | null;
          status: string;
          incident_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          recorded_by: string;
          violation_type: string;
          description: string;
          severity: string;
          sanction?: string | null;
          status?: string;
          incident_date: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["violations"]["Insert"]>;
      };
      student_files: {
        Row: {
          id: string;
          student_id: string;
          uploaded_by: string;
          file_name: string;
          file_path: string;
          file_category: string;
          file_size: number;
          mime_type: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          uploaded_by: string;
          file_name: string;
          file_path: string;
          file_category: string;
          file_size: number;
          mime_type: string;
          uploaded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["student_files"]["Insert"]>;
      };
      messages: {
        Row: {
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
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id: string;
          subject_line: string;
          body_text: string;
          status?: string;
          folder?: string;
          is_batch?: boolean;
          batch_filter?: string | null;
          sent_at?: string;
          read_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
      };
      faculty_evaluations: {
        Row: {
          id: string;
          student_id: string;
          schedule_id: string;
          ratings: Json;
          comments: string | null;
          school_year: string;
          semester: string;
          is_completed: boolean;
          submitted_at: string | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          schedule_id: string;
          ratings: Json;
          comments?: string | null;
          school_year: string;
          semester: string;
          is_completed?: boolean;
          submitted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["faculty_evaluations"]["Insert"]>;
      };
      graduation_applications: {
        Row: {
          id: string;
          student_id: string;
          school_year: string;
          month: string;
          status: string;
          checklist: Json;
          applied_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          school_year: string;
          month: string;
          status?: string;
          checklist?: Json;
          applied_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["graduation_applications"]["Insert"]>;
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string;
          action: string;
          resource: string;
          details: string | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action: string;
          resource: string;
          details?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: never; // Audit logs are append-only
      };
      calendar_events: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          event_type: string;
          start_date: string;
          end_date: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          event_type: string;
          start_date: string;
          end_date: string;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_events"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience type aliases
export type Student = Database["public"]["Tables"]["students"]["Row"];
export type Staff = Database["public"]["Tables"]["staff"]["Row"];
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type Section = Database["public"]["Tables"]["sections"]["Row"];
export type Schedule = Database["public"]["Tables"]["schedules"]["Row"];
export type Enrollment = Database["public"]["Tables"]["enrollments"]["Row"];
export type AcademicRecord = Database["public"]["Tables"]["academic_records"]["Row"];
export type Concern = Database["public"]["Tables"]["concerns"]["Row"];
export type ConcernResponse = Database["public"]["Tables"]["concern_responses"]["Row"];
export type Violation = Database["public"]["Tables"]["violations"]["Row"];
export type StudentFile = Database["public"]["Tables"]["student_files"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type FacultyEvaluation = Database["public"]["Tables"]["faculty_evaluations"]["Row"];
export type GraduationApplication = Database["public"]["Tables"]["graduation_applications"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
export type CalendarEvent = Database["public"]["Tables"]["calendar_events"]["Row"];
