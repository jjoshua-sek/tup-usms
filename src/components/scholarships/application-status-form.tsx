"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateScholarshipApplication } from "@/app/staff/scholarships/actions";
import { Button } from "@/components/ui/button";

const STATUSES = [
  "interest_declared",
  "documents_pending",
  "documents_complete",
  "under_review",
  "endorsed",
  "forwarded",
  "awarded",
  "rejected",
  "withdrawn",
] as const;

export function ApplicationStatusForm({
  applicationId,
  currentStatus,
}: {
  applicationId: string;
  currentStatus: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await updateScholarshipApplication(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Updated.");
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="application_id" value={applicationId} />

      <select name="status" defaultValue={currentStatus} className={inputClass}>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      <input
        name="note"
        maxLength={500}
        placeholder="Note to the student (optional)"
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
  "rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none";
