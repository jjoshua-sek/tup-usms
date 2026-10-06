import type { Metadata } from "next";

import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata: Metadata = {
  title: "Notifications",
};

/**
 * The staff inbox. Staff are notified too — a faculty complainant when a
 * hearing slot needs their approval, an officer when work is assigned — and
 * until this page existed the header bell sent them to an unbuilt
 * messaging screen instead.
 */
export default async function StaffNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;

  return (
    <NotificationsView
      basePath="/staff/notifications"
      home={{ label: "Overview", href: "/staff/dashboard" }}
      description="Approvals waiting on you, assignments and system notices."
      emptyDescription="When a hearing slot needs your approval or work is assigned to you, it will appear here."
      unreadOnly={filter === "unread"}
    />
  );
}
