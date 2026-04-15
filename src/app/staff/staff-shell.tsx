"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StaffShellProps {
  children: React.ReactNode;
  userName: string;
  role: "staff" | "admin";
  notificationCount: number;
}

export function StaffShell({
  children,
  userName,
  role,
  notificationCount,
}: StaffShellProps) {
  return (
    <AppShell
      role={role}
      userName={userName}
      notificationCount={notificationCount}
    >
      {children}
    </AppShell>
  );
}
