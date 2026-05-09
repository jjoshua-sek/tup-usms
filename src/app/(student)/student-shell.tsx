"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StudentShellProps {
  children: React.ReactNode;
  userName: string;
  userAvatar?: string;
  photoIsProvisional?: boolean;
  notificationCount: number;
}

export function StudentShell({
  children,
  userName,
  userAvatar,
  photoIsProvisional,
  notificationCount,
}: StudentShellProps) {
  return (
    <AppShell
      role="student"
      userName={userName}
      userAvatar={userAvatar}
      photoIsProvisional={photoIsProvisional}
      notificationCount={notificationCount}
    >
      {children}
    </AppShell>
  );
}
