"use client";

import { useState, useTransition } from "react";
import { Loader2, NotebookPen, X } from "lucide-react";
import { toast } from "sonner";

import { logGuidanceSession } from "@/app/staff/guidance/actions";
import { Button } from "@/components/ui/button";

const TYPES = [
  "walk_in",
  "scheduled",
  "referral",
  "risk_intervention",
  "disciplinary",
  "follow_up",
  "crisis",
] as const;

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
        <p className="font-display text-sm font-semibold">Log a counselling session</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Student number</span>
          <input
            name="student_number"
            required
            placeholder="TUPM-22-0148"
            className={inputClass}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Session type</span>
          <select name="session_type" defaultValue="walk_in" className={inputClass}>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Category</span>
          <input
            name="concern_category"
            maxLength={60}
            placeholder="academic / family / financial"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Presenting concern</span>
        <input
          name="presenting_concern"
          maxLength={300}
          placeholder="One line, in the student's own words where possible"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">
          Summary <span className="text-muted-foreground">(other OSA staff can read this)</span>
        </span>
        <textarea name="summary" rows={2} maxLength={2000} className={inputClass} />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">
          Confidential notes{" "}
          <span className="text-muted-foreground">(counselor-only — nobody else, ever)</span>
        </span>
        <textarea name="confidential_notes" rows={3} maxLength={5000} className={inputClass} />
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="follow_up_required" className="h-3.5 w-3.5" />
          Follow-up needed
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Follow-up date</span>
          <input type="date" name="follow_up_date" className={inputClass} />
        </label>
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save session
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
