import "server-only";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/types/osa";

/**
 * Who is this staff member, and what are they allowed to work on?
 *
 * The database is still the enforcement boundary — every table carries RLS
 * policies from 00013 that repeat these rules in SQL. This helper exists so a
 * page can show "you don't have access to this queue" instead of rendering a
 * working screen that silently returns zero rows, which is far more confusing
 * than a refusal.
 *
 * Role groupings mirror the OSA process document:
 *   OSA proper      run cases, scholarships, clearance, ID validation
 *   Guidance        counselling notes, compartmentalised from discipline
 *   Committees      PIC / SDB / CODI members, case review only
 *   Faculty         file complaints, approve hearing dates for their own case
 *   Security        gate feed only (see lib/access/guards.ts)
 */

export const OSA_ROLES: StaffRole[] = ["osa_head", "osa_officer", "admin"];
export const COMMITTEE_ROLES: StaffRole[] = ["pic_member", "sdb_member", "codi_member"];

export interface StaffContext {
  userId: string;
  staffId: string;
  fullName: string;
  role: StaffRole;
  canAccessConfidential: boolean;
  /** Runs the OSA workflows (cases, scholarships, clearance, ID). */
  isOsa: boolean;
  isCounselor: boolean;
  isCommittee: boolean;
  isAdmin: boolean;
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await loose(supabase)
    .from("staff")
    .select("id, full_name, role_type, can_access_confidential")
    .eq("user_id", user.id)
    .maybeSingle();

  const staff = data as {
    id: string;
    full_name: string;
    role_type: StaffRole;
    can_access_confidential: boolean | null;
  } | null;
  if (!staff) return null;

  return {
    userId: user.id,
    staffId: staff.id,
    fullName: staff.full_name,
    role: staff.role_type,
    canAccessConfidential: staff.can_access_confidential ?? false,
    isOsa: OSA_ROLES.includes(staff.role_type),
    isCounselor: staff.role_type === "guidance_counselor",
    isCommittee: COMMITTEE_ROLES.includes(staff.role_type),
    isAdmin: staff.role_type === "admin",
  };
}
