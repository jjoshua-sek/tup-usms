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
  | "graduation_apply";

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
