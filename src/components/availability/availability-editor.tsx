"use client";

import { useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  addAvailabilityBlock,
  deleteAvailabilityBlock,
} from "@/app/(student)/availability/actions";
import { Button } from "@/components/ui/button";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function AddBlockForm() {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await addAvailabilityBlock(formData);
          if (result.error) toast.error(result.error);
          else toast.success("Added to your schedule.");
        })
      }
      className="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-[1fr_auto_auto_1.4fr_auto] sm:items-end"
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">Day</span>
        <select name="day_of_week" defaultValue="Monday" className={inputClass}>
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">From</span>
        <input type="time" name="start_time" defaultValue="09:00" required className={inputClass} />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">To</span>
        <input type="time" name="end_time" defaultValue="10:30" required className={inputClass} />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">What is it? (optional)</span>
        <input
          name="label"
          placeholder="e.g. IT 301 lecture"
          maxLength={80}
          className={inputClass}
        />
      </label>

      <Button
        type="submit"
        disabled={isPending}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-1.5 h-4 w-4" />
        )}
        Add
      </Button>
    </form>
  );
}

export function DeleteBlockButton({ blockId }: { blockId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      aria-label="Remove this block"
      onClick={() =>
        startTransition(async () => {
          const result = await deleteAvailabilityBlock(blockId);
          if (result.error) toast.error(result.error);
          else toast.success("Removed.");
        })
      }
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
