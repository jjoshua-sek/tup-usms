"use client";

import { useTransition } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
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
          else toast.success("Validated. The ID opens the gates now, and the student has been notified.");
        })
      }
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="student_id" value={studentId} />
      <label htmlFor={`sticker-${studentId}`} className="sr-only">
        Sticker number
      </label>
      <input
        id={`sticker-${studentId}`}
        name="sticker_number"
        maxLength={40}
        placeholder="Sticker no. (optional)"
        disabled={isPending}
        className="h-8 w-40 rounded-md border border-border bg-background px-2.5 text-xs focus:border-tup-maroon-600 focus:outline-none"
      />
      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="h-8 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        title={`Validate for ${termLabel}`}
      >
        {isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="mr-1.5 h-3.5 w-3.5" />}
        Validate
      </Button>
    </form>
  );
}
