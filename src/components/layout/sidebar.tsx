"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BellIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  CalendarIcon,
  ChartBarIcon,
  ChatTextIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  DoorOpenIcon,
  FileTextIcon,
  FolderOpenIcon,
  GearSixIcon,
  HandHeartIcon,
  HeartbeatIcon,
  HouseIcon,
  IdentificationCardIcon,
  MedalIcon,
  NotePencilIcon,
  PulseIcon,
  ScanIcon,
  ShieldWarningIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserGearIcon,
  UserIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import type { Icon } from "@phosphor-icons/react";

import { announceSignOut } from "@/components/auth/session-guard";
import type { StaffNavIcon, StaffNavSection } from "@/lib/osa/staff-nav";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: Icon;
}

interface NavSection {
  label: string | null;
  items: NavItem[];
}

/**
 * Student navigation: ID validation and status, appointments, notifications,
 * scholarships, violations and clearance.
 */
const studentSections: NavSection[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: SquaresFourIcon },
      { label: "My Appointments", href: "/appointments", icon: CalendarBlankIcon },
      { label: "Notifications", href: "/notifications", icon: BellIcon },
      { label: "My Violations", href: "/violations", icon: ShieldWarningIcon },
      { label: "Concerns", href: "/concerns", icon: ChatTextIcon },
    ],
  },
  {
    label: "Services",
    items: [
      { label: "Scholarships", href: "/scholarships", icon: MedalIcon },
      { label: "Clearance", href: "/clearance", icon: ClipboardTextIcon },
      { label: "Digital ID", href: "/id", icon: IdentificationCardIcon },
      { label: "Academic Records", href: "/records", icon: FileTextIcon },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/profile", icon: UserIcon },
      { label: "My Schedule", href: "/availability", icon: CalendarIcon },
      { label: "Settings", href: "/settings", icon: GearSixIcon },
    ],
  },
];

/** The staff menu arrives from the server as names; these draw them. */
const STAFF_ICONS: Record<StaffNavIcon, Icon> = {
  home: HouseIcon,
  concerns: ChatTextIcon,
  cases: WarningIcon,
  complaint: NotePencilIcon,
  hearings: CalendarIcon,
  calendar: CalendarDotsIcon,
  students: UsersIcon,
  risk: PulseIcon,
  followups: HeartbeatIcon,
  guidance: HandHeartIcon,
  scholarships: MedalIcon,
  clearance: ClipboardTextIcon,
  idValidation: IdentificationCardIcon,
  documents: FolderOpenIcon,
  scanner: ScanIcon,
  gates: DoorOpenIcon,
  reports: ChartBarIcon,
  activity: ClockCounterClockwiseIcon,
  accounts: UserGearIcon,
  settings: GearSixIcon,
};

interface SidebarProps {
  role: "student" | "staff" | "admin";
  /** The staff menu for this person, built on the server (lib/osa/staff-nav.ts). */
  staffNav?: StaffNavSection[];
  /** Optional per-route badge counts for sidebar items (e.g. { "/concerns": 3 }) */
  badges?: Record<string, number>;
  open?: boolean;
  onClose?: () => void;
}

const HOME_HREFS = new Set(["/dashboard", "/staff/dashboard"]);

export function Sidebar({ role, staffNav, badges, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const sections: NavSection[] =
    role === "student"
      ? studentSections
      : (staffNav ?? []).map((section) => ({
          label: section.label,
          items: section.items.map((item) => ({ label: item.label, href: item.href, icon: STAFF_ICONS[item.icon] })),
        }));

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Other open tabs follow, rather than keep showing the signed-out
    // account's records until someone clicks in them.
    announceSignOut();
    router.push("/login");
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      {/* Sidebar: sits below the TUP header on desktop; a slide-out drawer on mobile. */}
      <aside
        className={cn(
          "fixed lg:sticky inset-y-0 lg:inset-auto left-0 z-40 lg:z-auto",
          "w-60 flex flex-col bg-white border-r border-border",
          "transition-transform duration-300 ease-[var(--ease-drawer)] lg:translate-x-0",
          "lg:top-[3.75rem] lg:h-[calc(100dvh-3.75rem)]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Mobile-only close button (the header is hidden behind the drawer on mobile) */}
        <div className="lg:hidden flex h-14 items-center justify-between px-4 border-b border-border bg-tup-maroon-600 text-white">
          <span className="text-base font-semibold">Menu</span>
          <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1.5 hover:bg-white/15">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Main menu" className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section, idx) => (
            <div key={section.label ?? "top"} className={cn(idx > 0 && "mt-6")}>
              {section.label && (
                <div className="px-3 pb-1.5 text-sm font-semibold text-muted-foreground">{section.label}</div>
              )}

              <ul className="space-y-1">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href || (!HOME_HREFS.has(item.href) && pathname.startsWith(item.href + "/"));
                  const badge = badges?.[item.href];

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-tup-maroon-600/40",
                          isActive ? "bg-tup-maroon-600 text-white" : "text-foreground hover:bg-muted",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-5 w-5 shrink-0",
                            isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        {badge !== undefined && badge > 0 && (
                          <span
                            className={cn(
                              "ml-auto rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums",
                              isActive ? "bg-white/25 text-white" : "bg-tup-gold-500 text-tup-maroon-700",
                            )}
                            aria-label={`${badge} waiting`}
                          >
                            {badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border px-3 py-3">
          <button
            onClick={handleSignOut}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-base text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <SignOutIcon className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
