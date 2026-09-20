"use client";

import { useTransition } from "react";
import { Handshake, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { signSettlement } from "@/app/(student)/violations/actions";
import { Button } from "@/components/ui/button";

/**
 * The student's acceptance of mediated terms.
 *
 * Phrased as "I accept these terms" rather than "sign": what the student is
 * doing is agreeing, and the word should say so. There is no decline button —
 * disagreeing is a conversation at the OSA, not a click that ends mediation.
 */
export function SignSettlementButton({ settlementId }: { settlementId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await signSettlement(settlementId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Recorded.");
        })
      }
      className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Handshake className="mr-1.5 h-3.5 w-3.5" />
      )}
      I accept these terms
    </Button>
  );
}
