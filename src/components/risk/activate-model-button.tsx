"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { activateRiskModel } from "@/app/staff/risk/actions";
import { Button } from "@/components/ui/button";

/**
 * Switches every score to another model version. Asks once more first,
 * because the whole At-Risk list changes the moment it is pressed.
 */
export function ActivateModelButton({ versionId, label }: { versionId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
        Use this model
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await activateRiskModel(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Model switched.");
          setConfirming(false);
        })
      }
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      <input type="hidden" name="version_id" value={versionId} />
      <span className="text-[11px] text-muted-foreground">Rescore everyone with {label}?</span>
      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Switch
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}
