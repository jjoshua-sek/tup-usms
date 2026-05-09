"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

interface ConcernRealtimeProps {
  concernId: string;
}

/**
 * Drop-in client component that activates realtime updates for a concern's
 * detail page. Renders nothing visible — just sets up Supabase channel
 * subscriptions and calls router.refresh() on changes.
 *
 * Two subscriptions:
 * 1. concern_responses filtered by concern_id — so new replies appear instantly
 * 2. concerns filtered by id — so AI summary, status changes, etc. update live
 */
export function ConcernRealtime({ concernId }: ConcernRealtimeProps) {
  // New replies in the thread
  useRealtimeRefresh({
    table: "concern_responses",
    filter: `concern_id=eq.${concernId}`,
    events: ["INSERT"],
  });

  // The concern row itself: AI summary populating, status changes, etc.
  useRealtimeRefresh({
    table: "concerns",
    filter: `id=eq.${concernId}`,
    events: ["UPDATE"],
  });

  return null;
}
