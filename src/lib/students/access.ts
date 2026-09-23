/**
 * Who may open a student's record, and which parts of it.
 *
 * The database is the enforcement boundary: every query on the record page
 * runs through the viewer's own session and RLS filters rows as it does
 * everywhere else. This module exists so the page can say "not shown to
 * your role" instead of rendering an empty section, because an empty
 * "Discipline" panel reads as "this student has no cases", which is a false
 * statement rather than a restricted one.
 *
 * OSA_RECORD_ROLES must match public.is_osa_staff() (migration 00013).
 * access.test.ts parses the migration and fails if they drift.
 */

import type { StaffRole } from "@/types/osa";

/** Mirrors public.is_osa_staff(). */
export const OSA_RECORD_ROLES = [
  "osa_head",
  "osa_officer",
  "guidance_counselor",
  "pic_member",
  "sdb_member",
  "admin",
] as const satisfies readonly StaffRole[];

/**
 * Registrar and Cashier process clearance and ID release, so they see those
 * parts of a record and nothing else. Faculty and Security are refused:
 * filing a complaint needs a name, not a disciplinary history, and the gate
 * feed has its own screen.
 */
export const RECORD_ROLES: readonly StaffRole[] = [...OSA_RECORD_ROLES, "registrar", "cashier"];

export interface RecordAccess {
  /** Cases, service, appeals, notices served, documents, scholarships, concerns. */
  osaRecord: boolean;
  /** The live early-warning score; mirrors /staff/risk (OSA officers and counselors). */
  risk: boolean;
  /** Session scheduling only; mirrors the "restricted sessions" policy on guidance_sessions. */
  guidance: boolean;
}

/** Null when the role may not open student records at all. */
export function recordAccess(staff: {
  role: StaffRole;
  isOsa: boolean;
  isCounselor: boolean;
}): RecordAccess | null {
  if (!RECORD_ROLES.includes(staff.role)) return null;

  return {
    osaRecord: (OSA_RECORD_ROLES as readonly StaffRole[]).includes(staff.role),
    risk: staff.isOsa || staff.isCounselor,
    guidance: staff.role === "guidance_counselor" || staff.role === "osa_head",
  };
}
