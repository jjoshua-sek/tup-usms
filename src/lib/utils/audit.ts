import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

type AuditAction =
  | "login"
  | "logout"
  | "profile_update"
  | "concern_submit"
  | "concern_respond"
  | "violation_record"
  | "file_upload"
  | "file_download"
  | "grade_access"
  | "password_change"
  | "message_send"
  | "enrollment_change"
  | "evaluation_submit"
  | "graduation_apply"
  // Campus access control (migration 00015)
  | "id_validation_requested"
  | "access_gate_created"
  | "access_gate_updated"
  | "access_gate_key_rotated"
  | "access_desk_scan"
  | "access_anomaly_reviewed"
  // OSA workflows (migrations 00007–00012)
  | "clearance_requested"
  | "clearance_reviewed"
  | "scholarship_interest"
  | "case_filed"
  | "case_updated"
  | "hearing_scheduled"
  | "hearing_notified"
  | "academic_doc_reviewed"
  | "id_validation_reviewed"
  | "intervention_created";

/**
 * Logs an audit event to the audit_logs table.
 * Call this from Server Actions and Route Handlers.
 *
 * The audit_logs table is append-only (no UPDATE/DELETE via RLS),
 * creating a tamper-proof trail per RA 10173 compliance.
 */
export async function logAuditEvent(
  userId: string,
  action: AuditAction,
  resource: string,
  details?: Record<string, unknown>
) {
  try {
    const headersList = await headers();
    const ip =
      headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      headersList.get("x-real-ip") ||
      "unknown";
    const userAgent = headersList.get("user-agent") || "unknown";

    const supabase = await createClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Types will be auto-generated from Supabase
    await (supabase as any).from("audit_logs").insert({
      user_id: userId,
      action,
      resource,
      details: details ? JSON.stringify(details) : null,
      ip_address: ip,
      user_agent: userAgent,
    });
  } catch (error) {
    // Audit logging should never break the main flow
    console.error("Audit log error:", error);
  }
}
