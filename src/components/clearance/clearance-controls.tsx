"use client";

import { useState, useTransition } from "react";
import { CheckCircleIcon as CheckCircle2, CircleNotchIcon as Loader2, MagnifyingGlassIcon as ScanSearch } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import {
  advanceClearance,
  resolveClearanceHold,
  runClearanceCheck,
} from "@/app/staff/clearance/actions";
import { Button } from "@/components/ui/button";
import { clearanceHasFee } from "@/lib/osa/clearance-fee";

/** The first check is the step to take, so it is the filled button; a re-run is outlined. */
export function RunCheckButton({ requestId, again = false }: { requestId: string; again?: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={again ? "outline" : "default"}
      className={again ? undefined : "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"}
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await runClearanceCheck(requestId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Checked.");
        })
      }
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <ScanSearch className="mr-1.5 h-4 w-4" />
      )}
      {again ? "Run the check again" : "Run the record check"}
    </Button>
  );
}

export function ResolveHoldButton({ holdId }: { holdId: string }) {
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <CheckCircle2 className="h-4 w-4" />
        Clear this hold
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={500}
        placeholder="How was it settled?"
        aria-label="How was it settled?"
        className={`${inputClass} min-w-40 flex-1`}
      />
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await resolveClearanceHold(holdId, notes);
            if (result.error) toast.error(result.error);
            else {
              toast.success(result.message ?? "Cleared.");
              setOpen(false);
            }
          })
        }
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Clear the hold
      </Button>
      <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
        Cancel
      </Button>
    </div>
  );
}

const NEXT_STATUSES = [
  { value: "verifying", label: "Verifying" },
  { value: "fee_pending", label: "Fee pending" },
  { value: "ready", label: "Ready for pickup" },
  { value: "issued", label: "Issued" },
  { value: "rejected", label: "Rejected" },
] as const;

export function AdvanceClearanceForm({ requestId, requestType }: { requestId: string; requestType: string }) {
  const [isPending, startTransition] = useTransition();
  // Only the Good Moral certificate is paid for at the Cashier (G3).
  const hasFee = clearanceHasFee(requestType);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await advanceClearance(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Updated.");
        })
      }
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="request_id" value={requestId} />

      <label className="block space-y-1">
        <span className="text-base font-medium">New status</span>
        <select name="status" defaultValue="verifying" className={`${inputClass} block`}>
          {NEXT_STATUSES.filter((status) => hasFee || status.value !== "fee_pending").map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>

      {hasFee && (
        <label className="block space-y-1">
          <span className="text-base font-medium">OR number</span>
          <input name="or_number" maxLength={60} className={`${inputClass} block w-36`} />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-base font-medium">Certificate number</span>
        <input name="certificate_number" maxLength={60} className={`${inputClass} block w-40`} />
      </label>
      <label className="block min-w-48 flex-1 space-y-1">
        <span className="text-base font-medium">
          Note <span className="font-normal text-muted-foreground">(the reason, if rejecting)</span>
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
