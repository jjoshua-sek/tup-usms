"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { escalateCase, recordEscalationOutcome } from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";

const BODIES = [
  {
    value: "PIC",
    label: "PIC — Preliminary Investigation Committee",
    note: "Fact-finding before a formal board hearing.",
  },
  {
    value: "SDB",
    label: "SDB — Student Disciplinary Board",
    note: "Formal hearing; can recommend suspension or worse.",
  },
  {
    value: "CODI",
    label: "CODI — Committee on Decorum and Investigation",
    note: "Harassment and similar matters. Makes the case confidential immediately and removes it from the general queue.",
  },
] as const;

export function EscalateForm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string>("PIC");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" />
        Refer to a committee
      </Button>
    );
  }

  const selected = BODIES.find((option) => option.value === body);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await escalateCase(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Referred.");
          setOpen(false);
        })
      }
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="case_id" value={caseId} />

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Refer this case</p>
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
        <span className="text-[11px] font-medium">Committee</span>
        <select
          name="escalated_to"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className={inputClass}
        >
          {BODIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <p
          className={`rounded-md p-2 text-[11px] leading-relaxed ${
            selected.value === "CODI"
              ? "border border-red-200 bg-red-50 text-red-900"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {selected.note}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Why</span>
        <textarea
          name="reason"
          required
          rows={3}
          minLength={20}
          maxLength={2000}
          placeholder="What about this case needs a committee rather than the OSA's own process?"
          className={inputClass}
        />
      </label>

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Refer
      </Button>
    </form>
  );
}

const OUTCOMES = [
  { value: "sanction_recommended", label: "Sanction recommended" },
  { value: "upheld", label: "Complaint upheld (no sanction yet)" },
  { value: "referred_further", label: "Referred further" },
  { value: "dismissed", label: "Dismissed" },
] as const;

export function EscalationOutcomeForm({ escalationId }: { escalationId: string }) {
  const [outcome, setOutcome] = useState<string>("sanction_recommended");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordEscalationOutcome(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Recorded.");
        })
      }
      className="mt-2 space-y-2 border-t border-border pt-2"
    >
      <input type="hidden" name="escalation_id" value={escalationId} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Decision</span>
          <select
            name="outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className={inputClass}
          >
            {OUTCOMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Committee reference</span>
          <input
            name="external_reference"
            maxLength={80}
            placeholder="e.g. SDB-2026-014"
            className={inputClass}
          />
        </label>
      </div>

      {outcome === "sanction_recommended" && (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Sanction</span>
          <input
            name="sanction_recommended"
            required
            maxLength={500}
            placeholder="e.g. Suspension for 15 school days, effective 3 March"
            className={inputClass}
          />
          <span className="block text-[10px] text-muted-foreground">
            This is written onto the case record and shown to the student.
          </span>
        </label>
      )}

      <textarea
        name="outcome_notes"
        rows={2}
        maxLength={2000}
        placeholder="Notes from the decision (optional)"
        className={inputClass}
      />

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-full">
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Record decision
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none";
