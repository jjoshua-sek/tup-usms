/**
 * Who may see and manage campus access.
 *
 * Mirrors the SQL helpers `can_view_access()` / `can_manage_access()` from
 * migration 00015. The database is the real boundary — these exist so pages
 * and Server Actions can fail fast with a readable message instead of handing
 * back an empty RLS-filtered list.
 */

import "server-only";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { ACCESS_MANAGE_ROLES, ACCESS_VIEW_ROLES } from "@/lib/osa/roles";
import type { StaffRole } from "@/types/osa";

/** Security guards watch the gate feed; they do not configure gates (lists in lib/osa/roles.ts). */

export interface AccessStaff {
  userId: string;
  staffId: string;
  fullName: string;
  role: StaffRole;
  canView: boolean;
  canManage: boolean;
}

export function canViewAccess(role: StaffRole | null | undefined): boolean {
  return !!role && ACCESS_VIEW_ROLES.includes(role);
}

export function canManageAccess(role: StaffRole | null | undefined): boolean {
  return !!role && ACCESS_MANAGE_ROLES.includes(role);
}

export async function getAccessStaff(): Promise<AccessStaff | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // `role_type` arrived in migration 00006 and isn't in the hand-maintained
  // Database generic, which would otherwise narrow this select to `never`.
  const db = loose(supabase);
  const { data } = await db
    .from("staff")
    .select("id, full_name, role_type")
    .eq("user_id", user.id)
    .maybeSingle();

  const staff = data as { id: string; full_name: string; role_type: StaffRole } | null;
  if (!staff) return null;

  return {
    userId: user.id,
    staffId: staff.id,
    fullName: staff.full_name,
    role: staff.role_type,
    canView: canViewAccess(staff.role_type),
    canManage: canManageAccess(staff.role_type),
  };
}
