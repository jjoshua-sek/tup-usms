"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { chooseMinorProcess } from "@/app/staff/cases/actions";
import { getMinorOffenseCounts } from "@/app/staff/cases/sanction-actions";
import { Button } from "@/components/ui/button";
import { MINOR_PROCESSES, MINOR_PROCESS_META, repeatOffenseAdvice, type MinorProcess } from "@/lib/osa/minor-process";

/**
 * How a minor case is handled (checklist A4): counselling then an apology
 * letter, an apology letter only, or a written warning. A repeat offender's
 * count is shown beside the choice, because the handbook's ladder asks for
 * community service from the second offense.
 */
export function MinorProcessForm({ caseId, current }: { caseId: string; current: MinorProcess }) {
  const [choice, setChoice] = useState<MinorProcess>(current);
  const [advice, setAdvice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    void getMinorOffenseCounts(caseId).then((result) => {
      // All past minor offenses count (checklist B1).
      if (active && result.counts) setAdvice(repeatOffenseAdvice(result.counts.cumulative));
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await chooseMinorProcess(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Saved.");
        })
      }
      className="space-y-3"
    >
      <input type="hidden" name="case_id" value={caseId} />
      <fieldset className="space-y-2">
        <legend className="sr-only">How this minor case is handled</legend>
        {MINOR_PROCESSES.map((process) => (
          <label
            key={process}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors ${
              choice === process ? "border-tup-maroon-600 bg-tup-maroon-50/40 dark:bg-tup-maroon-950/20" : "border-border hover:bg-muted/50"
            }`}
          >
            <input
              type="radio"
              name="process"
              value={process}
              checked={choice === process}
              onChange={() => setChoice(process)}
              className="mt-1 accent-tup-maroon-600"
            />
            <span>
              <span className="font-medium">{MINOR_PROCESS_META[process].label}</span>
              {process === "counselling_apology" && <span className="ml-1.5 text-xs text-muted-foreground">(default)</span>}
              <span className="block text-xs text-muted-foreground">{MINOR_PROCESS_META[process].description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === "warning_only" && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">The warning, as the student will read it</span>
          <textarea
            name="warning"
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            placeholder="e.g. You entered campus without a validated ID on Oct 20. A repeat will be treated as a second offense."
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none"
          />
        </label>
      )}

      {advice && choice === "warning_only" && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {advice}
        </p>
      )}

      <Button type="submit" size="sm" disabled={pending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {choice === "warning_only" ? "Close with this warning" : choice === "apology_only" ? "Ask for the apology letter" : "Save"}
      </Button>
    </form>
  );
}
