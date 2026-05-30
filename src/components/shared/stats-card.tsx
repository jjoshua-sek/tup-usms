// NOTE: Intentionally NOT a Client Component.
// Server Components can pass Lucide icon components (which are functions)
// directly to other Server Components. If we marked this "use client",
// every page rendering it would have to serialize the icon prop —
// which fails because functions aren't serializable across the boundary.

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  /** Small label above the value (e.g. "Active Concerns") */
  label: string;
  /** The big stat value (string for things like "Enrolled" or numbers) */
  value: string | number;
  /** Optional small caption below the value (e.g. "2 in review · 1 pending") */
  trend?: string;
  /**
   * Visual semantic for the trend caption.
   * "up" = green (good news), "warn" = amber (needs attention),
   * "danger" = red (urgent), "neutral" = muted gray.
   */
  trendTone?: "up" | "warn" | "danger" | "neutral";
  /** Icon shown in the upper-right corner */
  icon: LucideIcon;
  /**
   * Visual semantic for the icon tile background.
   * Matches the mockup's tone-coded stat icons.
   */
  iconTone?: "neutral" | "success" | "warn" | "danger" | "ai";
  /** Override the value color (e.g. red for "High Urgency: 3") */
  valueClassName?: string;
  className?: string;
}

const iconToneStyles: Record<NonNullable<StatsCardProps["iconTone"]>, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-[#dcfce7] text-[#166534]",
  warn:    "bg-[#fef3c7] text-[#92400e]",
  danger:  "bg-[#fef2f2] text-[#b91c1c]",
  ai:      "bg-ai-accent-soft text-ai-accent",
};

const trendToneStyles: Record<NonNullable<StatsCardProps["trendTone"]>, string> = {
  up:      "text-[#16a34a]",
  warn:    "text-[#f59e0b]",
  danger:  "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * Compact institutional stat card matching the mockup precisely.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │ Label              [icon tile]  │
 *   │                                 │
 *   │ 26px value                      │
 *   │ trend                           │
 *   └─────────────────────────────────┘
 *
 * Padding is 20px (institutional density, not generous SaaS spacing).
 * Value uses tabular nums so "$ 1,234" aligns with "$    25" vertically
 * when stacked in stat grids.
 */
export function StatsCard({
  label,
  value,
  trend,
  trendTone = "neutral",
  icon: Icon,
  iconTone = "neutral",
  valueClassName,
  className,
}: StatsCardProps) {
  return (
    <div
      className={cn(
        "relative bg-card border border-border rounded-md p-5",
        className
      )}
    >
      <div className="flex items-start justify-between mb-2.5">
        <span className="text-xs text-muted-foreground font-medium">
          {label}
        </span>
        <div
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
            iconToneStyles[iconTone]
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>

      <div
        className={cn(
          "text-[26px] font-semibold leading-none tabular-nums tracking-tight mb-1",
          valueClassName
        )}
      >
        {value}
      </div>

      {trend && (
        <div className={cn("text-[11px]", trendToneStyles[trendTone])}>
          {trend}
        </div>
      )}
    </div>
  );
}
