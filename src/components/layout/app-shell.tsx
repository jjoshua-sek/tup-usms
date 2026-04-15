"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

interface AppShellProps {
  children: React.ReactNode;
  role: "student" | "staff" | "admin";
  userName?: string;
  userAvatar?: string;
  notificationCount?: number;
}

/**
 * The main application shell wrapping all authenticated pages.
 * Provides the sidebar navigation and top bar with user menu.
 *
 * On mobile: sidebar is a slide-out drawer.
 * On desktop (lg+): sidebar is always visible, content shifts right.
 */
export function AppShell({
  children,
  role,
  userName,
  userAvatar,
  notificationCount,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        role={role}
        userName={userName}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content area — offset by sidebar width on desktop */}
      <div className="lg:pl-64">
        <Topbar
          onMenuClick={() => setSidebarOpen(true)}
          userName={userName}
          userAvatar={userAvatar}
          role={role}
          notificationCount={notificationCount}
        />

        <main className="p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
