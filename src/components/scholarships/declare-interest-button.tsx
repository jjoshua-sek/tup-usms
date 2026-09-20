"use client";

import { useTransition } from "react";
import { Check, HandHeart, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { declareScholarshipInterest } from "@/app/(student)/scholarships/actions";
import { Button } from "@/components/ui/button";

interface DeclareInterestButtonProps {
  scholarshipId: string;
  alreadyDeclared: boolean;
}

export function DeclareInterestButton({
  scholarshipId,
  alreadyDeclared,
}: DeclareInterestButtonProps) {
  const [isPending, startTransition] = useTransition();

  if (alreadyDeclared) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
        <Check className="h-3.5 w-3.5" />
        On the OSA&apos;s list
      </span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await declareScholarshipInterest(scholarshipId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Noted.");
        })
      }
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <HandHeart className="mr-1.5 h-3.5 w-3.5" />
      )}
      I intend to apply
    </Button>
  );
}
