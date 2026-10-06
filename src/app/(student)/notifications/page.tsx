import type { Metadata } from "next";

import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata: Metadata = {
  title: "Notifications",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;

  return (
    <NotificationsView
      basePath="/notifications"
      home={{ label: "Home", href: "/dashboard" }}
      description="Summons, hearing schedules, clearance updates and scholarship reminders land here."
      emptyDescription="When the OSA schedules a meeting, updates your clearance, or opens a scholarship you qualify for, you'll see it here."
      footer="Anything that asks something of you — a meeting, an apology letter, a deadline to appeal — is also emailed to your institutional address, and each notice above says whether that email went out. Routine updates can be switched off in Settings; notices that start a deadline cannot."
      unreadOnly={filter === "unread"}
    />
  );
}
