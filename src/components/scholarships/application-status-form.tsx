"use client";

import { useTransition } from "react";
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { updateScholarshipApplication } from "@/app/staff/scholarships/actions";
import { Button } from "@/components/ui/button";
import { APPLICATION_STATUS_LABELS } from "@/types/osa";

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
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="application_id" value={applicationId} />

      <label className="block space-y-1">
        <span className="text-base font-medium">Status</span>
        <select name="status" defaultValue={currentStatus} className={`${inputClass} block`}>
          {Object.entries(APPLICATION_STATUS_LABELS).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block min-w-48 flex-1 space-y-1">
        <span className="text-base font-medium">
          Note to the student <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <input name="note" maxLength={500} className={`${inputClass} block w-full`} />
      </label>

      <Button type="submit" disabled={isPending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save the change
      </Button>
    </form>
  );
}

const inputClass =
  "min-h-10 rounded-md border border-border bg-background px-3 py-2 text-base focus:border-tup-maroon-600 focus:outline-none focus:ring-3 focus:ring-tup-maroon-600/20";
