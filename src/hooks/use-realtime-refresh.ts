"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface UseRealtimeRefreshOptions {
  /** The table to subscribe to (e.g., "concern_responses") */
  table: string;
  /**
   * PostgREST filter string for narrowing the subscription
   * (e.g., "concern_id=eq.<uuid>")
   * Without a filter, you'd get ALL changes across all rows.
   */
  filter?: string;
  /** Which event types to react to. Defaults to all (INSERT, UPDATE, DELETE) */
  events?: ("INSERT" | "UPDATE" | "DELETE")[];
  /** Schema. Defaults to "public" */
  schema?: string;
  /** Disable subscription without unmounting the component */
  enabled?: boolean;
}

/**
 * Subscribe to Supabase Realtime changes on a table and call
 * `router.refresh()` whenever a matching event occurs.
 *
 * This is the simplest pattern for adding realtime to Server-Component pages:
 * the server renders the initial data, this hook listens for changes, and
 * `router.refresh()` re-runs the server queries — keeping all RLS, joins,
 * and data resolution server-side.
 *
 * Trade-off: a network round-trip per update vs. instant local state changes.
 * For chat-like UX (replies, status changes), the latency is imperceptible.
 *
 * Usage:
 * ```tsx
 * useRealtimeRefresh({
 *   table: "concern_responses",
 *   filter: `concern_id=eq.${concernId}`,
 * });
 * ```
 */
export function useRealtimeRefresh({
  table,
  filter,
  events = ["INSERT", "UPDATE", "DELETE"],
  schema = "public",
  enabled = true,
}: UseRealtimeRefreshOptions) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    // Channel names should be unique per subscription. Including filter
    // ensures different rows on the same table get different channels.
    const channelName = `realtime:${schema}:${table}:${filter || "all"}`;

    const channel = supabase.channel(channelName);

    for (const event of events) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types don't expose the literal "postgres_changes" string
        "postgres_changes" as any,
        {
          event,
          schema,
          table,
          ...(filter ? { filter } : {}),
        },
        () => {
          router.refresh();
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, table, filter, events.join(","), schema, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
