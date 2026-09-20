"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";

import {
  advanceClearance,
  resolveClearanceHold,
  runClearanceCheck,
} from "@/app/staff/clearance/actions";
import { Button } from "@/components/ui/button";

export function RunCheckButton({ requestId }: { requestId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
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
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
      )}
      Run record check
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
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
      >
        <CheckCircle2 className="h-3 w-3" />
        Clear hold
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={500}
        placeholder="How was it resolved?"
        className="min-w-[160px] flex-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none"
      />
      <Button
        type="button"
        size="sm"
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
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Confirm
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

export function AdvanceClearanceForm({ requestId }: { requestId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await advanceClearance(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Updated.");
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="request_id" value={requestId} />

      <select name="status" defaultValue="verifying" className={inputClass}>
        {NEXT_STATUSES.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>

      <input name="or_number" maxLength={60} placeholder="OR no." className={inputClass} />
      <input
        name="certificate_number"
        maxLength={60}
        placeholder="Certificate no."
        className={inputClass}
      />
      <input
        name="note"
        maxLength={500}
        placeholder="Note / rejection reason"
        className={`${inputClass} min-w-[160px] flex-1`}
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
