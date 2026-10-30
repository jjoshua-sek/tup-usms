import type { StaffRole } from "@/types/osa";

/**
 * Which staff roles belong to which group. Plain data, so the server-side
 * guards (staff-context.ts, access/guards.ts) and the staff menu
 * (staff-nav.ts) read the same lists and cannot drift apart.
 */

/** The OSA itself. Mirrors public.is_osa_staff() (migration 00013). */
export const OSA_ROLES: StaffRole[] = ["osa_head", "osa_officer", "admin"];

/** Disciplinary committees that hear escalated cases. */
export const COMMITTEE_ROLES: StaffRole[] = ["pic_member", "sdb_member", "codi_member"];

/** May watch the gates and scan IDs. */
export const ACCESS_VIEW_ROLES: StaffRole[] = ["osa_head", "osa_officer", "security_guard", "admin"];

/** May add gates and rotate their keys. */
export const ACCESS_MANAGE_ROLES: StaffRole[] = ["osa_head", "osa_officer", "admin"];
