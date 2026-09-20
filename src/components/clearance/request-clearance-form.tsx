"use client";

import { useState, useTransition } from "react";
import { FilePlus2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { requestClearance } from "@/app/(student)/clearance/actions";
import { Button } from "@/components/ui/button";

const TYPES = [
  { value: "good_moral", label: "Certificate of Good Moral Character" },
  { value: "graduation_clearance", label: "Graduation clearance" },
  { value: "transfer_clearance", label: "Transfer clearance" },
  { value: "general_clearance", label: "General clearance" },
] as const;

export function RequestClearanceForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        <FilePlus2 className="mr-1.5 h-4 w-4" />
        Request clearance
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await requestClearance(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Request filed.");
          setOpen(false);
        })
      }
      className="space-y-3 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold">New clearance request</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-medium">What do you need?</span>
        <select name="request_type" defaultValue="good_moral" className={inputClass}>
          {TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">What is it for?</span>
        <input
          name="purpose"
          required
          maxLength={300}
          placeholder="e.g. Board exam application, employment requirement, transfer to another school"
          className={inputClass}
        />
        <span className="block text-[11px] text-muted-foreground">
          The purpose is printed on the certificate, so be specific.
        </span>
      </label>

      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        File request
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
