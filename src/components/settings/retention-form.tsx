"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveRetention } from "@/app/staff/settings/actions";
import { Button } from "@/components/ui/button";
import type { RetentionSettings } from "@/lib/settings/retention";

/** The administrator records the periods the DPO set (OSA checklist I4). */
export function RetentionForm({ current }: { current: RetentionSettings }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await saveRetention(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Saved.");
        })
      }
      className="grid gap-3 sm:grid-cols-3 sm:items-end"
    >
      <label className="block space-y-1">
        <span className="text-[12px] font-medium">Student records (years after graduation)</span>
        <input id="recordYears" name="recordYears" type="number" min={1} max={50} required defaultValue={current.recordYears} className={inputClass} />
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium">Gate scan logs (days)</span>
        <input id="accessLogDays" name="accessLogDays" type="number" min={30} max={3650} required defaultValue={current.accessLogDays} className={inputClass} />
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium">DPO memo or reference</span>
        <input
          id="dpoReference"
          name="dpoReference"
          required
          minLength={3}
          maxLength={120}
          defaultValue={current.dpoReference ?? ""}
          placeholder="e.g. DPO Memo No. 2026-14"
          className={inputClass}
        />
      </label>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" disabled={pending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save retention
        </Button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
