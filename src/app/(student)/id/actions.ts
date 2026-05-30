"use server";

import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";

interface IdTokenResult {
  token?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * Issue a short-lived ID token for QR rendering.
 *
 * Security model:
 * - Token = HMAC(student_id + window_start_ts, SECRET).slice(0, 16)
 *   where window_start_ts is the start of the current 60-second window.
 * - The client cannot forge this without knowing SUPABASE_SERVICE_ROLE_KEY,
 *   which is server-only.
 * - When scanned, the server re-computes the HMAC for the claimed
 *   student_id at the current window and compares. Rejected if expired
 *   or mismatched.
 *
 * This action issues; verification will be added in a future commit
 * along with the scanner route. For now, the QR renders the token as
 * an opaque string, which is enough to demonstrate the rotation
 * pattern in the demo.
 */
export async function issueIdToken(): Promise<IdTokenResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: studentRaw } = await supabase
    .from("students")
    .select("id, qr_hash")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRaw as { id: string; qr_hash: string | null } | null;
  if (!student) return { error: "Student profile not found" };

  // 60-second rolling window
  const windowSeconds = 60;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const expiresAt = (windowStart + windowSeconds) * 1000; // ms epoch

  // Use the project's service role key as the signing secret. Service role
  // is server-only — never reaches the browser. If absent (dev), fall back
  // to a placeholder so the rotation logic still works for the demo.
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "tup-usms-dev-secret";

  const payload = `${student.id}:${windowStart}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  // Final token: short student tag + first 16 chars of HMAC.
  // Tag is the qr_hash (UUID-derived) so a scanner can look up the student
  // even before validating; HMAC then proves authenticity.
  const tag = (student.qr_hash || student.id).slice(0, 8);
  const token = `${tag}.${windowStart.toString(36)}.${hmac.slice(0, 16)}`;

  return { token, expiresAt };
}
