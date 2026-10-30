import { RECORD_ROLES } from "@/lib/students/access";
import type { StaffRole } from "@/types/osa";

import { ACCESS_VIEW_ROLES, COMMITTEE_ROLES, OSA_ROLES } from "./roles";

/**
 * The staff menu, built for one person: only the pages their role can open,
 * grouped by task and named in plain words. Every rule below mirrors the
 * check at the top of that page, so hiding a link never takes access away;
 * the page still refuses anyone else on its own.
 *
 * Icons are named, not imported: the menu is built on the server and handed
 * to the client sidebar, and only plain data crosses that line.
 */

export type StaffNavIcon =
  | "home" | "concerns" | "cases" | "complaint" | "hearings" | "calendar" | "students"
  | "risk" | "followups" | "guidance" | "scholarships"
  | "clearance" | "idValidation" | "documents" | "scanner" | "gates"
  | "reports" | "activity" | "accounts" | "settings";

export interface StaffNavItem {
  label: string;
  href: string;
  icon: StaffNavIcon;
}

export interface StaffNavSection {
  /** Null for the unlabeled first group (Home). */
  label: string | null;
  items: StaffNavItem[];
}

interface Viewer {
  role: StaffRole | null;
  isOsa: boolean;
  isCommittee: boolean;
  isCounselor: boolean;
}

interface Entry extends StaffNavItem {
  /** The same test the page's own guard applies. */
  shows: (viewer: Viewer) => boolean;
}

const everyone = () => true;
const osa = (v: Viewer) => v.isOsa;
const osaOrCounselor = (v: Viewer) => v.isOsa || v.isCounselor;

const SECTIONS: Array<{ label: string | null; entries: Entry[] }> = [
  {
    label: null,
    entries: [{ label: "Home", href: "/staff/dashboard", icon: "home", shows: everyone }],
  },
  {
    label: "Students and cases",
    entries: [
      // The list shows what each role may read (RLS); every staff member records concerns.
      { label: "Student concerns", href: "/staff/concerns", icon: "concerns", shows: everyone },
      { label: "Discipline cases", href: "/staff/cases", icon: "cases", shows: (v) => v.isOsa || v.isCommittee },
      // Any staff member may file a complaint (checklist A3); those without the case list reach the form here.
      { label: "File a complaint", href: "/staff/cases/new", icon: "complaint", shows: (v) => !!v.role && !v.isOsa && !v.isCommittee },
      { label: "Hearings", href: "/staff/hearings", icon: "hearings", shows: (v) => v.isOsa || v.isCommittee || v.role === "faculty" },
      { label: "Calendar", href: "/staff/calendar", icon: "calendar", shows: everyone },
      { label: "Student records", href: "/staff/students", icon: "students", shows: (v) => !!v.role && RECORD_ROLES.includes(v.role) },
    ],
  },
  {
    label: "Student support",
    entries: [
      { label: "At-risk students", href: "/staff/risk", icon: "risk", shows: osaOrCounselor },
      { label: "Follow-ups", href: "/staff/interventions", icon: "followups", shows: osaOrCounselor },
      { label: "Guidance sessions", href: "/staff/guidance", icon: "guidance", shows: osaOrCounselor },
      { label: "Scholarships", href: "/staff/scholarships", icon: "scholarships", shows: osa },
    ],
  },
  {
    label: "Front desk",
    entries: [
      { label: "Clearance requests", href: "/staff/clearance", icon: "clearance", shows: (v) => v.isOsa || v.role === "registrar" || v.role === "cashier" },
      { label: "ID validation", href: "/staff/id-validation", icon: "idValidation", shows: osa },
      { label: "Check documents", href: "/staff/documents", icon: "documents", shows: osa },
      { label: "Scan an ID", href: "/staff/scanner", icon: "scanner", shows: (v) => !!v.role && ACCESS_VIEW_ROLES.includes(v.role) },
      { label: "Campus gates", href: "/staff/gates", icon: "gates", shows: (v) => !!v.role && ACCESS_VIEW_ROLES.includes(v.role) },
    ],
  },
  {
    label: "Records and settings",
    entries: [
      { label: "Reports", href: "/staff/reports", icon: "reports", shows: osa },
      { label: "Activity history", href: "/staff/audit", icon: "activity", shows: (v) => v.role === "admin" || v.role === "osa_head" },
      { label: "User accounts", href: "/staff/accounts", icon: "accounts", shows: (v) => v.role === "admin" },
      { label: "Settings", href: "/staff/settings", icon: "settings", shows: everyone },
    ],
  },
];

/** The menu for one staff role. Null means an account with no staff record. */
export function staffNavFor(role: StaffRole | null): StaffNavSection[] {
  // UITC (stored as registrar) works in Accounts only (checklist I1).
  if (role === "registrar") {
    return [
      {
        label: null,
        items: [
          { label: "User accounts", href: "/staff/accounts", icon: "accounts" },
          { label: "Settings", href: "/staff/settings", icon: "settings" },
        ],
      },
    ];
  }

  const viewer: Viewer = {
    role,
    isOsa: !!role && OSA_ROLES.includes(role),
    isCommittee: !!role && COMMITTEE_ROLES.includes(role),
    isCounselor: role === "guidance_counselor",
  };

  return SECTIONS.map(({ label, entries }) => ({
    label,
    items: entries.filter((entry) => entry.shows(viewer)).map(({ label: itemLabel, href, icon }) => ({ label: itemLabel, href, icon })),
  })).filter((section) => section.items.length > 0);
}
