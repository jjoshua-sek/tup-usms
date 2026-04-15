"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StudentShellProps {
  children: React.ReactNode;
  userName: string;
  userAvatar?: string;
  notificationCount: number;
}

export function StudentShell({
  children,
  userName,
  userAvatar,
  notificationCount,
}: StudentShellProps) {
  return (
    <AppShell
      role="student"
      userName={userName}
      userAvatar={userAvatar}
      notificationCount={notificationCount}
    >
      {children}
    </AppShell>
  );
}
