"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StaffShellProps {
  children: React.ReactNode;
  userName: string;
  userSubtitle?: string;
  role: "staff" | "admin";
  notificationCount: number;
  sidebarBadges?: Record<string, number>;
}

export function StaffShell({
  children,
  userName,
  userSubtitle,
  role,
  notificationCount,
  sidebarBadges,
}: StaffShellProps) {
  return (
    <AppShell
      role={role}
      userName={userName}
      userSubtitle={userSubtitle}
      notificationCount={notificationCount}
      sidebarBadges={sidebarBadges}
    >
      {children}
    </AppShell>
  );
}
