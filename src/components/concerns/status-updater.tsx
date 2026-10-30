"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircleIcon as CheckCircle2, CircleNotchIcon as Loader2, ArrowsClockwiseIcon as RefreshCw } from "@phosphor-icons/react/ssr";

import {
  updateConcernStatus,
  resummarizeConcern,
} from "@/app/staff/concerns/actions";
import { CONCERN_STATUSES } from "@/lib/validations/concern";
import { CONCERN_STATUSES as STATUS_STYLES } from "@/components/concerns/status-badge";

type ConcernStatusValue = (typeof CONCERN_STATUSES)[number];

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StatusUpdaterProps {
  concernId: string;
  currentStatus: string;
  hasAiSummary: boolean;
}

// The same words as the status badges on the list.
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_STYLES).map(([status, style]) => [status, style.label]),
);

export function StatusUpdater({
  concernId,
  currentStatus,
  hasAiSummary,
}: StatusUpdaterProps) {
  const router = useRouter();
  const [optimisticStatus, setOptimisticStatus] = useState(currentStatus);
  const [isPending, startTransition] = useTransition();
  const [isResummarizing, startResummarize] = useTransition();

  const handleStatusChange = (newStatus: string | null) => {
    if (!newStatus || newStatus === optimisticStatus) return;
    const previous = optimisticStatus;
    setOptimisticStatus(newStatus); // optimistic update

    startTransition(async () => {
      const result = await updateConcernStatus(concernId, newStatus);
      if (result.error) {
        toast.error(result.error);
        setOptimisticStatus(previous); // revert
        return;
      }
      toast.success(`Status changed to ${STATUS_LABELS[newStatus]}`);
      router.refresh();
    });
  };

  const handleResummarize = () => {
    startResummarize(async () => {
      toast.info("Writing the summary again…");
      const result = await resummarizeConcern(concernId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Summary updated");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-base font-medium text-muted-foreground whitespace-nowrap">
          Status
        </span>
        <Select
          value={optimisticStatus}
          onValueChange={handleStatusChange}
          disabled={isPending}
        >
          <SelectTrigger className="h-10 w-44 text-base" aria-label="Status">
            <SelectValue>{(value: string) => STATUS_LABELS[value] ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(CONCERN_STATUSES as readonly ConcernStatusValue[]).map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <Button
        variant="outline"
        onClick={handleResummarize}
        disabled={isResummarizing}
      >
        {isResummarizing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {hasAiSummary ? "Write the summary again" : "Write a summary"}
      </Button>
    </div>
  );
}

/**
 * One-click shortcut for the most common status change. It goes through the
 * same server action as the status select, so the RLS check, audit entry and
 * revalidation are identical. The page keys StatusUpdater on the status, so
 * the select picks up the new value when the refresh lands.
 */
export function MarkResolvedButton({
  concernId,
  currentStatus,
}: {
  concernId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Resolving a closed concern would move it backwards, and resolving a
  // resolved one does nothing; the select is still there for either.
  const done = currentStatus === "resolved" || currentStatus === "closed";

  const handleClick = () => {
    startTransition(async () => {
      const result = await updateConcernStatus(concernId, "resolved");
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Status changed to ${STATUS_LABELS.resolved}`);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={done || isPending}
      className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      {done ? STATUS_LABELS[currentStatus] : "Mark as resolved"}
    </button>
  );
}
