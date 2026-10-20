"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

import {
  updateConcernStatus,
  resummarizeConcern,
} from "@/app/staff/concerns/actions";
import { CONCERN_STATUSES } from "@/lib/validations/concern";

type ConcernStatusValue = (typeof CONCERN_STATUSES)[number];

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface StatusUpdaterProps {
  concernId: string;
  currentStatus: string;
  hasAiSummary: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_review: "In Review",
  resolved: "Resolved",
  closed: "Closed",
};

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
      toast.info("Re-running AI analysis...");
      const result = await resummarizeConcern(concernId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("AI summary updated");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
          Status:
        </span>
        <Select
          value={optimisticStatus}
          onValueChange={handleStatusChange}
          disabled={isPending}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
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
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={handleResummarize}
        disabled={isResummarizing}
        title={
          hasAiSummary
            ? "Re-run AI analysis on this concern"
            : "Run AI analysis on this concern"
        }
      >
        {isResummarizing ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
        )}
        {hasAiSummary ? "Re-analyze" : "Run AI"}
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
      className="px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors inline-flex items-center justify-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5" />
      )}
      {done ? STATUS_LABELS[currentStatus] : "Mark Resolved"}
    </button>
  );
}
