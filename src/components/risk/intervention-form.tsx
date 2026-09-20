"use client";

import { useState, useTransition } from "react";
import { HeartPulse, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { createInterventionFromRisk, updateIntervention } from "@/app/staff/risk/actions";
import { Button } from "@/components/ui/button";

interface Suggestion {
  type: string;
  reason: string;
  priority: "normal" | "high" | "urgent";
}

interface InterventionFormProps {
  studentId: string;
  suggestions: Suggestion[];
}

/**
 * Opens outreach for one student.
 *
 * The model's suggestions are pre-filled but every field stays editable — the
 * score proposes, a counselor decides. Nothing here is automatic: no
 * intervention is ever created without a staff member pressing this button.
 */
export function InterventionForm({ studentId, suggestions }: InterventionFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <HeartPulse className="mr-1.5 h-3.5 w-3.5" />
        Open intervention
      </Button>
    );
  }

  const first = suggestions[0];

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await createInterventionFromRisk(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Intervention opened.");
          setOpen(false);
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="student_id" value={studentId} />

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">New intervention</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Type</span>
        <input
          name="intervention_type"
          defaultValue={first?.type ?? "guidance_referral"}
          list="intervention-types"
          maxLength={80}
          required
          className={inputClass}
        />
        <datalist id="intervention-types">
          {suggestions.map((suggestion) => (
            <option key={suggestion.type} value={suggestion.type} />
          ))}
          <option value="guidance_referral" />
          <option value="academic_coaching" />
          <option value="financial_aid_referral" />
          <option value="attendance_check_in" />
        </datalist>
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Priority</span>
        <select name="priority" defaultValue={first?.priority ?? "normal"} className={inputClass}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>

      <textarea
        name="rationale"
        rows={2}
        maxLength={1000}
        defaultValue={first?.reason ?? ""}
        placeholder="Why now? This is recorded with the assessment."
        className={inputClass}
      />

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Open intervention
      </Button>
    </form>
  );
}

const STATUSES = [
  "recommended",
  "approved",
  "scheduled",
  "in_progress",
  "completed",
  "declined",
  "cancelled",
] as const;

export function InterventionStatusForm({
  interventionId,
  currentStatus,
}: {
  interventionId: string;
  currentStatus: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await updateIntervention(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Updated.");
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="intervention_id" value={interventionId} />

      <select name="status" defaultValue={currentStatus} className={`${inputClass} w-auto`}>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <select name="outcome_rating" defaultValue="" className={`${inputClass} w-auto`}>
        <option value="">Outcome…</option>
        <option value="improved">Improved</option>
        <option value="no_change">No change</option>
        <option value="worsened">Worsened</option>
        <option value="inconclusive">Inconclusive</option>
      </select>

      <input
        name="outcome"
        maxLength={1000}
        placeholder="What happened? (optional)"
        className={`${inputClass} min-w-[180px] flex-1`}
      />

      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Save
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-tup-maroon-600 focus:outline-none";
