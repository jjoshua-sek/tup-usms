"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { acknowledgeHearing } from "@/app/(student)/appointments/actions";
import { Button } from "@/components/ui/button";

export function AcknowledgeButton({ hearingId }: { hearingId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await acknowledgeHearing(hearingId);
          if (result.error) toast.error(result.error);
          else toast.success("Thanks — the OSA can see you've been notified.");
        })
      }
      className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check className="mr-1.5 h-3.5 w-3.5" />
      )}
      I&apos;ve seen this
    </Button>
  );
}
