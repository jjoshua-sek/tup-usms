"use client";

import { AppShell } from "@/components/layout/app-shell";

interface StudentShellProps {
  children: React.ReactNode;
  userName: string;
  userAvatar?: string;
  userSubtitle?: string;
  photoIsProvisional?: boolean;
  notificationCount: number;
  sidebarBadges?: Record<string, number>;
}

export function StudentShell({
  children,
  userName,
  userAvatar,
  userSubtitle,
  photoIsProvisional,
  notificationCount,
  sidebarBadges,
}: StudentShellProps) {
  return (
    <AppShell
      role="student"
      userName={userName}
      userAvatar={userAvatar}
      userSubtitle={userSubtitle}
      photoIsProvisional={photoIsProvisional}
      notificationCount={notificationCount}
      sidebarBadges={sidebarBadges}
    >
      {children}
    </AppShell>
  );
}
