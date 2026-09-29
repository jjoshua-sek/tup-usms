"use client";

import { useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { sendStaffPasswordReset } from "@/app/staff/accounts/actions";

/**
 * Emails one staff member a link to choose a new password. Staff accounts
 * have no address on record, so it asks for one; the last address used is
 * filled in next time.
 */
export function StaffResetForm({ staffId, defaultEmail }: { staffId: string; defaultEmail?: string | null }) {
  const [isPending, startTransition] = useTransition();
  const inputId = `staff-reset-${staffId}`;

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await sendStaffPasswordReset(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Reset link queued.");
        })
      }
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <input type="hidden" name="staff_id" value={staffId} />
      <label htmlFor={inputId} className="sr-only">
        Email address to send the reset link to
      </label>
      <input
        id={inputId}
        name="email"
        type="email"
        required
        defaultValue={defaultEmail ?? ""}
        placeholder="Their personal email"
        className="h-8 w-52 rounded-md border border-border bg-background px-2.5 text-[12px] focus:border-tup-maroon-600 focus:outline-none"
      />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
        Email reset link
      </button>
    </form>
  );
}
