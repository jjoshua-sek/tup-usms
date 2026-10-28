"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StaffShellProps {
  children: React.ReactNode;
  userName: string;
  userSubtitle?: string;
  role: "staff" | "admin";
  /** A UITC account sees only Accounts (I1). */
  accountsOnly?: boolean;
  notificationCount: number;
  sidebarBadges?: Record<string, number>;
  idleMinutes: number;
}

export function StaffShell({
  children,
  userName,
  userSubtitle,
  role,
  accountsOnly,
  notificationCount,
  sidebarBadges,
  idleMinutes,
}: StaffShellProps) {
  return (
    <AppShell
      role={role}
      accountsOnly={accountsOnly}
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
