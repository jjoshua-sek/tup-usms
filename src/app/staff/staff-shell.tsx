"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StaffShellProps {
  children: React.ReactNode;
  userName: string;
  userSubtitle?: string;
  role: "staff" | "admin";
  notificationCount: number;
  sidebarBadges?: Record<string, number>;
  idleMinutes: number;
}

export function StaffShell({
  children,
  userName,
  userSubtitle,
  role,
  notificationCount,
  sidebarBadges,
  idleMinutes,
}: StaffShellProps) {
  return (
    <AppShell
      role={role}
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
