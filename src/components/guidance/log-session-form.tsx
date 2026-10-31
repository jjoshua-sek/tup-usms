"use client";

import { useState, useTransition } from "react";
import { CircleNotchIcon as Loader2, NotePencilIcon as NotebookPen, XIcon as X } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { logGuidanceSession } from "@/app/staff/guidance/actions";
import { Button } from "@/components/ui/button";
import {
  SESSION_CATEGORIES,
  SESSION_CATEGORY_LABELS,
  SESSION_TYPES,
  SESSION_TYPE_LABELS,
} from "@/lib/osa/guidance-labels";

export function LogSessionForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        <NotebookPen className="mr-1.5 h-4 w-4" />
        Log a session
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await logGuidanceSession(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Logged.");
          setOpen(false);
        })
      }
      className="space-y-3 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <p className="font-display text-base font-semibold">Log a counselling session</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-base font-medium">Student number</span>
          <input
            name="student_number"
            required
            placeholder="TUPM-22-0148"
            className={inputClass}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-base font-medium">Session type</span>
          <select name="session_type" defaultValue="walk_in" className={inputClass}>
            {SESSION_TYPES.map((type) => (
              <option key={type} value={type}>
                {SESSION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-base font-medium">Category</span>
          <select name="concern_category" defaultValue="" className={inputClass}>
            <option value="">Not set</option>
            {SESSION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {SESSION_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-base font-medium">Presenting concern</span>
        <input
          name="presenting_concern"
          maxLength={300}
          placeholder="One line, in the student's own words where possible"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-base font-medium">
          Summary <span className="font-normal text-muted-foreground">(other OSA staff can read this)</span>
        </span>
        <textarea name="summary" rows={2} maxLength={2000} className={inputClass} />
      </label>

      <label className="block space-y-1">
        <span className="text-base font-medium">
          Confidential notes{" "}
          <span className="font-normal text-muted-foreground">(only you can ever read these)</span>
        </span>
        <textarea name="confidential_notes" rows={3} maxLength={5000} className={inputClass} />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-10 items-center gap-2 text-base">
          <input type="checkbox" name="follow_up_required" className="h-5 w-5" />
          Follow-up needed
        </label>
        <label className="block space-y-1">
          <span className="text-base font-medium">Follow-up date</span>
          <input type="date" name="follow_up_date" className={inputClass} />
        </label>
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save the session
      </Button>
    </form>
  );
}

const inputClass =
  "w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-base focus:border-tup-maroon-600 focus:outline-none focus:ring-3 focus:ring-tup-maroon-600/20";
