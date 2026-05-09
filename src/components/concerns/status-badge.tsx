import { cn } from "@/lib/utils";
import { Clock, Eye, CheckCircle2, XCircle } from "lucide-react";

/**
 * Status badge for concerns. Distinct from urgency — status reflects
 * workflow state (where the concern is in the resolution pipeline),
 * urgency reflects priority (how urgent the issue itself is).
 *
 * pending   → submitted, no staff action yet
 * in_review → a staff member has picked it up
 * resolved  → answered/addressed; awaiting student confirmation
 * closed    → finalized, no further action
 */
export const CONCERN_STATUSES = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
  in_review: {
    label: "In Review",
    icon: Eye,
    className: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30",
  },
  resolved: {
    label: "Resolved",
    icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  closed: {
    label: "Closed",
    icon: XCircle,
    className: "bg-muted text-muted-foreground border-border",
  },
} as const;

export type ConcernStatus = keyof typeof CONCERN_STATUSES;

interface StatusBadgeProps {
  status: string;
  showIcon?: boolean;
  className?: string;
}

export function StatusBadge({ status, showIcon = true, className }: StatusBadgeProps) {
  const config =
    status in CONCERN_STATUSES
      ? CONCERN_STATUSES[status as ConcernStatus]
      : null;

  if (!config) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
          "bg-muted text-muted-foreground border-border",
          className
        )}
      >
        {status}
      </span>
    );
  }

  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
        config.className,
        className
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {config.label}
    </span>
  );
}
