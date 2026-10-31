"use client";

import { useTransition } from "react";
import { SealCheckIcon as BadgeCheck, CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { validateAtCounter } from "@/app/staff/id-validation/actions";
import { Button } from "@/components/ui/button";

/**
 * Validate a student's ID at the OSA window: the officer has checked the
 * face against the photo on file and applied the term sticker.
 */
export function CounterValidateForm({ studentId, termLabel }: { studentId: string; termLabel: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await validateAtCounter(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Validated. The ID opens the gates now, and the student has been notified.");
        })
      }
      className="flex flex-wrap items-center gap-2"
      // The one save that works on the offline copy (it waits in the outbox).
      data-offline-allowed
    >
      <input type="hidden" name="student_id" value={studentId} />
      <label htmlFor={`sticker-${studentId}`} className="sr-only">
        Sticker number
      </label>
      <input
        id={`sticker-${studentId}`}
        name="sticker_number"
        maxLength={40}
        placeholder="Sticker number"
        aria-label="Sticker number (optional)"
        disabled={isPending}
        className="h-10 w-44 rounded-md border border-border bg-background px-3 text-base focus:border-tup-maroon-600 focus:outline-none"
      />
      <Button
        type="submit"
        disabled={isPending}
        className="h-8 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        title={`Validate for ${termLabel}`}
      >
        {isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1.5 h-4 w-4" />}
        Validate
      </Button>
    </form>
  );
}
