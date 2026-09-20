import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Bell, BellOff } from "lucide-react";

import {
  MarkAllReadButton,
  MarkReadButton,
} from "@/components/notifications/notification-actions";
import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { NotificationRow } from "@/types/osa";

export const metadata: Metadata = {
  title: "Notifications",
};

const PRIORITY_META: Record<NotificationRow["priority"], { label: string; tone: Tone }> = {
  low: { label: "FYI", tone: "neutral" },
  normal: { label: "Update", tone: "info" },
  high: { label: "Important", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const unreadOnly = filter === "unread";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = loose(supabase);

  let query = db
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (unreadOnly) query = query.eq("is_read", false);

  const [{ data: rows }, { count: unreadCount }] = await Promise.all([
    query,
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_read", false),
  ]);

  const notifications = (rows as NotificationRow[] | null) ?? [];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Notifications" }]}
        title="Notifications"
        description="Summons, hearing schedules, clearance updates and scholarship reminders land here."
      >
        <MarkAllReadButton disabled={(unreadCount ?? 0) === 0} />
      </PageHeader>

      {/* Filter tabs — plain links so the list stays a Server Component */}
      <div className="mb-4 flex items-center gap-1 border-b border-border">
        <FilterTab href="/notifications" label="All" active={!unreadOnly} />
        <FilterTab
          href="/notifications?filter=unread"
          label={`Unread${unreadCount ? ` (${unreadCount})` : ""}`}
          active={unreadOnly}
        />
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={unreadOnly ? BellOff : Bell}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          description={
            unreadOnly
              ? "You're all caught up."
              : "When the OSA schedules a meeting, updates your clearance, or opens a scholarship you qualify for, you'll see it here."
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {notifications.map((notification) => {
            const priority = PRIORITY_META[notification.priority];
            return (
              <li
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5",
                  !notification.is_read && "bg-tup-maroon-600/[0.03]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    notification.is_read ? "bg-transparent" : "bg-tup-maroon-600",
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{notification.title}</p>
                    {notification.priority !== "normal" && (
                      <ToneBadge label={priority.label} tone={priority.tone} />
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {relativeTime(notification.created_at)}
                    </span>
                  </div>

                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {notification.body}
                  </p>

                  {notification.action_url && (
                    <Link
                      href={notification.action_url}
                      className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
                    >
                      {notification.action_label ?? "Open"}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                {!notification.is_read && <MarkReadButton notificationId={notification.id} />}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Notifications marked for email are also sent to your institutional address. You can
        change delivery preferences in Settings.
      </p>
    </div>
  );
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "border-tup-maroon-600 text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
