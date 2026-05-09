import { cn } from "@/lib/utils";
import { AlertOctagon, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

/**
 * Visual treatment for AI-assigned urgency levels.
 * Color semantics align with risk perception:
 * - critical: red (immediate action)
 * - high:     orange (escalate today)
 * - medium:   amber (this week)
 * - low:      emerald (no rush)
 */
export const URGENCY_LEVELS = {
  critical: {
    label: "Critical",
    icon: AlertOctagon,
    badge:
      "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    bar: "bg-red-500",
    description: "Requires immediate attention",
  },
  high: {
    label: "High",
    icon: AlertTriangle,
    badge:
      "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    bar: "bg-orange-500",
    description: "Escalate within 24 hours",
  },
  medium: {
    label: "Medium",
    icon: Info,
    badge:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    bar: "bg-amber-500",
    description: "Address this week",
  },
  low: {
    label: "Low",
    icon: CheckCircle2,
    badge:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    bar: "bg-emerald-500",
    description: "Routine follow-up",
  },
} as const;

export type UrgencyLevel = keyof typeof URGENCY_LEVELS;

interface UrgencyBadgeProps {
  level: string | null;
  /**
   * Compact: just colored text + icon, no border.
   * Default: pill-style badge with border.
   */
  variant?: "default" | "compact";
  showIcon?: boolean;
  className?: string;
}

export function UrgencyBadge({
  level,
  variant = "default",
  showIcon = true,
  className,
}: UrgencyBadgeProps) {
  if (!level || !(level in URGENCY_LEVELS)) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          "bg-muted text-muted-foreground border-border",
          className
        )}
      >
        Unprocessed
      </span>
    );
  }

  const config = URGENCY_LEVELS[level as UrgencyLevel];
  const Icon = config.icon;

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          {
            critical: "text-red-700 dark:text-red-400",
            high: "text-orange-700 dark:text-orange-400",
            medium: "text-amber-700 dark:text-amber-400",
            low: "text-emerald-700 dark:text-emerald-400",
          }[level as UrgencyLevel],
          className
        )}
      >
        {showIcon && <Icon className="h-3 w-3" />}
        {config.label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        config.badge,
        className
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {config.label}
    </span>
  );
}

/**
 * Vertical color bar shown on the left of a concern card,
 * giving a quick visual scan of urgency before reading.
 */
export function UrgencyBar({
  level,
  className,
}: {
  level: string | null;
  className?: string;
}) {
  const config =
    level && level in URGENCY_LEVELS
      ? URGENCY_LEVELS[level as UrgencyLevel]
      : null;
  return (
    <div
      className={cn(
        "w-1 rounded-full",
        config?.bar || "bg-muted",
        className
      )}
    />
  );
}
