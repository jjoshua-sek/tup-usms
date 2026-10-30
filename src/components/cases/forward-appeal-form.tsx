"use client";

import { useTransition } from "react";
import { CircleNotchIcon as Loader2, PaperPlaneRightIcon as Send } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { forwardAppeal } from "@/app/staff/cases/sanction-actions";
import { Button } from "@/components/ui/button";

/** The OSA passes a filed appeal to the body that decides it (checklist B5). */
export function ForwardAppealForm({ appealId, bodyLabel }: { appealId: string; bodyLabel: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await forwardAppeal(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Forwarded.");
        })
      }
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="appeal_id" value={appealId} />
      <label htmlFor={`ref-${appealId}`} className="sr-only">
        Transmittal or reference number
      </label>
      <input
        id={`ref-${appealId}`}
        name="external_reference"
        maxLength={80}
        placeholder="Transmittal / reference no. (optional)"
        className="h-8 min-w-[200px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs focus:border-tup-maroon-600 focus:outline-none"
      />
      <Button type="submit" size="sm" disabled={pending} className="h-8 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
        Forward to the {bodyLabel}
      </Button>
    </form>
  );
}
