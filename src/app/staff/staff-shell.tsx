"use client";

import { AppShell } from "@/components/layout/app-shell";
import type { StaffNavSection } from "@/lib/osa/staff-nav";

interface StaffShellProps {
  children: React.ReactNode;
  userName: string;
  userSubtitle?: string;
  role: "staff" | "admin";
  /** This person's menu, built in the staff layout. */
  staffNav: StaffNavSection[];
  notificationCount: number;
  sidebarBadges?: Record<string, number>;
  idleMinutes: number;
}

export function StaffShell({
  children,
  userName,
  userSubtitle,
  role,
  staffNav,
  notificationCount,
  sidebarBadges,
  idleMinutes,
}: StaffShellProps) {
  return (
    <AppShell
      role={role}
      staffNav={staffNav}
      idleMinutes={idleMinutes}
      userName={userName}
      userSubtitle={userSubtitle}
      notificationCount={notificationCount}
      sidebarBadges={sidebarBadges}
    >
      {children}
    </AppShell>
  );
}
