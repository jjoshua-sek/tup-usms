"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { assignCaseOfficer } from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";

/** The OSA head hands a restricted case to an officer (checklist A7). */
export function AssignOfficerForm({
  caseId,
  officers,
  current,
}: {
  caseId: string;
  officers: Array<{ id: string; full_name: string }>;
  current: string | null;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await assignCaseOfficer(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Assigned.");
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="case_id" value={caseId} />
      <label htmlFor={`officer-${caseId}`} className="sr-only">
        Assigned officer
      </label>
      <select
        id={`officer-${caseId}`}
        name="officer_id"
        defaultValue={current ?? ""}
        required
        className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:border-tup-maroon-600 focus:outline-none"
      >
        <option value="" disabled>
          Choose an officer
        </option>
        {officers.map((officer) => (
          <option key={officer.id} value={officer.id}>
            {officer.full_name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="h-8">
        {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Assign
      </Button>
    </form>
  );
}
