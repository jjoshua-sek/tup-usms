"use client";

import { useState, useTransition } from "react";
import { HeartbeatIcon as HeartPulse, CircleNotchIcon as Loader2, XIcon as X } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { createInterventionFromRisk, updateIntervention } from "@/app/staff/risk/actions";
import { Button } from "@/components/ui/button";
import {
  FOLLOW_UP_OUTCOME_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_TYPE_LABELS,
  followUpTypeLabel,
} from "@/lib/risk/follow-up-labels";

interface Suggestion {
  type: string;
  reason: string;
  priority: "normal" | "high" | "urgent";
}

interface InterventionFormProps {
  studentId: string;
  suggestions: Suggestion[];
}

/** The "Other" choice in the type list: the officer types the kind instead. */
const OTHER = "__other";

/**
 * Starts a follow-up (a risk_interventions row) for one student.
 *
 * The model's suggestions are pre-filled but every field stays editable — the
 * score proposes, a counselor decides. Nothing here is automatic: no
 * follow-up is ever created without a staff member pressing this button.
 */
export function InterventionForm({ studentId, suggestions }: InterventionFormProps) {
  const [open, setOpen] = useState(false);
  const first = suggestions[0];
  const [type, setType] = useState(first?.type ?? "guidance_referral");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <HeartPulse className="mr-1.5 h-4 w-4" />
        Start a follow-up
      </Button>
    );
  }

  // The model's suggestions first, marked, then every other known kind.
  const suggested = new Set(suggestions.map((suggestion) => suggestion.type));
  const choices = [
    ...suggestions.map((suggestion) => suggestion.type),
    ...Object.keys(FOLLOW_UP_TYPE_LABELS).filter((code) => !suggested.has(code)),
  ];

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await createInterventionFromRisk(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Follow-up started.");
          setOpen(false);
        })
      }
      className="w-full space-y-3 rounded-lg border border-border p-4"
    >
      <input type="hidden" name="student_id" value={studentId} />

      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">New follow-up</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-base font-medium">What kind</span>
          <select
            name={type === OTHER ? undefined : "intervention_type"}
            value={type}
            onChange={(event) => setType(event.target.value)}
            className={inputClass}
          >
            {choices.map((code) => (
              <option key={code} value={code}>
                {followUpTypeLabel(code)}
                {suggested.has(code) ? " (suggested)" : ""}
              </option>
            ))}
            <option value={OTHER}>Other (type it in)</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-base font-medium">Priority</span>
          <select name="priority" defaultValue={first?.priority ?? "normal"} className={inputClass}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>

      {type === OTHER && (
        <label className="block space-y-1">
          <span className="text-base font-medium">Kind of follow-up</span>
          <input name="intervention_type" maxLength={80} minLength={2} required autoFocus className={inputClass} />
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-base font-medium">
          Why now <span className="font-normal text-muted-foreground">(kept with the score)</span>
        </span>
        <textarea name="rationale" rows={2} maxLength={1000} defaultValue={first?.reason ?? ""} className={inputClass} />
      </label>

      <Button type="submit" disabled={isPending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Start the follow-up
      </Button>
    </form>
  );
}

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
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="intervention_id" value={interventionId} />

      <label className="block space-y-1">
        <span className="text-base font-medium">Status</span>
        <select name="status" defaultValue={currentStatus} className={`${inputClass} w-auto`}>
          {Object.entries(FOLLOW_UP_STATUS_LABELS).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-base font-medium">How it went</span>
        <select name="outcome_rating" defaultValue="" className={`${inputClass} w-auto`}>
          <option value="">Not yet known</option>
          {Object.entries(FOLLOW_UP_OUTCOME_LABELS).map(([rating, label]) => (
            <option key={rating} value={rating}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block min-w-48 flex-1 space-y-1">
        <span className="text-base font-medium">
          What happened <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <input name="outcome" maxLength={1000} className={inputClass} />
      </label>

      <Button type="submit" disabled={isPending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save the change
      </Button>
    </form>
  );
}

const inputClass =
  "w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-base focus:border-tup-maroon-600 focus:outline-none focus:ring-3 focus:ring-tup-maroon-600/20";
