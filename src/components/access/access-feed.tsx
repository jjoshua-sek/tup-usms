"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Radio, XCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { ACCESS_REASON_META, type AccessReason } from "@/lib/access/decide";
import { formatManila } from "@/lib/utils/time";

export interface AccessEventRow {
  id: string;
  gate_label: string;
  direction: "entry" | "exit";
  decision: "allow" | "deny";
  enforced: boolean;
  reason: string;
  normalized_student_number: string | null;
  occurred_at: string;
}

interface AccessFeedProps {
  initialEvents: AccessEventRow[];
}

const MAX_ROWS = 40;

/**
 * Live gate feed.
 *
 * Realtime carries the row as the database sees it, so the guard's screen
 * updates without polling. The list is capped at 40 rows: a busy morning can
 * produce thousands of events, and an unbounded list would grow the DOM until
 * the kiosk-adjacent monitor stutters.
 */
export function AccessFeed({ initialEvents }: AccessFeedProps) {
  const [events, setEvents] = useState<AccessEventRow[]>(initialEvents);
  const [live, setLive] = useState(false);
  const seenIds = useRef(new Set(initialEvents.map((event) => event.id)));

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("access-events-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "access_events" },
        (payload) => {
          const row = payload.new as AccessEventRow;
          if (seenIds.current.has(row.id)) return;
          seenIds.current.add(row.id);
          setEvents((current) => [row, ...current].slice(0, MAX_ROWS));
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="font-display text-sm font-semibold">Live gate activity</p>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] ${
            live ? "text-emerald-600" : "text-muted-foreground"
          }`}
        >
          <Radio className={`h-3 w-3 ${live ? "animate-pulse" : ""}`} />
          {live ? "Live" : "Connecting…"}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No scans recorded yet today.
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
          {events.map((event) => {
            const meta = ACCESS_REASON_META[event.reason as AccessReason];
            const monitorOnly = event.decision === "deny" && !event.enforced;

            return (
              <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                {event.decision === "allow" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle
                    className={`h-4 w-4 shrink-0 ${monitorOnly ? "text-amber-600" : "text-red-600"}`}
                  />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    <span className="font-mono">
                      {event.normalized_student_number ?? "unreadable"}
                    </span>
                    <span className="ml-2 text-muted-foreground">{event.gate_label}</span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {meta?.staffLabel ?? event.reason}
                    {monitorOnly ? " · monitor mode, not blocked" : ""}
                  </p>
                </div>

                <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  {event.direction === "entry" ? (
                    <ArrowDownLeft className="h-3 w-3" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3" />
                  )}
                  {formatManila(event.occurred_at, {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
