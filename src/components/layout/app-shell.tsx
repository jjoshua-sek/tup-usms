"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { TupHeader } from "./tup-header";

interface AppShellProps {
  children: React.ReactNode;
  role: "student" | "staff" | "admin";
  userName?: string;
  userAvatar?: string;
  /** Short role line shown under the name in the header (e.g. "BSIT · 4th Year") */
  userSubtitle?: string;
  photoIsProvisional?: boolean;
  notificationCount?: number;
  /** Per-route badge counts for the sidebar (e.g. { "/concerns": 3 }) */
  sidebarBadges?: Record<string, number>;
}

/**
 * Application shell — full-width TUP header on top, sidebar + main below.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ TUP HEADER (maroon, gold border, sticky)      │ 60px
 *   ├──────────┬───────────────────────────────────┤
 *   │ Sidebar  │ Main content                       │
 *   │  240px   │  (page-specific, Stone-100 bg)    │
 *   │ white    │                                    │
 *   └──────────┴───────────────────────────────────┘
 *
 * Mobile: sidebar collapses to a slide-out drawer triggered by the
 * header's hamburger menu.
 */
export function AppShell({
  children,
  role,
  userName,
  userSubtitle,
  photoIsProvisional,
  notificationCount,
  sidebarBadges,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Note: userAvatar is intentionally NOT shown in the header avatar — the
  // mockup uses initials inside a translucent circle for institutional consistency.
  // The full photo is still shown on the profile page and student detail views.

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <TupHeader
        onMenuClick={() => setSidebarOpen(true)}
        userName={userName}
        userSubtitle={userSubtitle}
        photoIsProvisional={photoIsProvisional}
        isStaffConsole={role === "staff" || role === "admin"}
        notificationCount={notificationCount}
        role={role}
      />

      <div className="flex flex-1 lg:grid lg:grid-cols-[240px_1fr]">
        <Sidebar
          role={role}
          badges={sidebarBadges}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 sm:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
