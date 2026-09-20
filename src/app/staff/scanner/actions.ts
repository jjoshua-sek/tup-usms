"use server";

import { getAccessStaff } from "@/lib/access/guards";
import { verifyScan, type VerifyScanResult } from "@/lib/access/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { checkRateLimit } from "@/lib/utils/rate-limit";

export interface DeskScanResult extends VerifyScanResult {
  /**
   * Open discipline cases, for OSA staff only. A guard scanning at the gate
   * has no business seeing case counts, and an open case never blocks entry —
   * only a formal suspension does.
   */
  openCases?: number | null;
  error?: string;
}

/**
 * Front-desk ID verification.
 *
 * Same engine as the turnstile (`verifyScan`), with three differences:
 *   - context 'osa_desk', so anti-passback doesn't fire at a counter
 *   - the scan is attributed to the signed-in staff member
 *   - the real reason is spelled out instead of the discreet kiosk wording
 */
export async function verifyAtDesk(payload: string): Promise<DeskScanResult> {
  const staff = await getAccessStaff();
  if (!staff?.canView) {
    return {
      error: "You don't have permission to verify IDs.",
    } as DeskScanResult;
  }

  const limit = checkRateLimit({
    identifier: `desk-scan:${staff.userId}`,
    maxRequests: 120,
    windowSeconds: 60,
  });
  if (!limit.success) {
    return { error: "Too many scans. Please wait a moment." } as DeskScanResult;
  }

  const result = (await verifyScan({
    payload,
    gate: null,
    context: "osa_desk",
    deskLabel: "OSA Front Desk",
    scannedBy: staff.userId,
  })) as DeskScanResult;

  const studentId = result.staffDetail?.studentId;
  if (studentId && staff.role !== "security_guard") {
    const db = loose(createAdminClient());
    const { count } = await db
      .from("violation_cases")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .not("status", "in", "(closed,dismissed)");

    result.openCases = count ?? 0;
  } else {
    result.openCases = null;
  }

  return result;
}
