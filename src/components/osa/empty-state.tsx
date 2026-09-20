import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Usually a Link styled with buttonVariants(). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Empty states carry real weight in this system: for most students "nothing
 * here" is the *good* outcome (no violations, no holds, no open cases), so
 * the copy should read as reassurance rather than as a missing feature.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "grid place-items-center gap-2 rounded-xl border border-dashed border-border bg-card p-10 text-center",
        className,
      )}
    >
      <Icon className="h-6 w-6 text-muted-foreground/50" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
