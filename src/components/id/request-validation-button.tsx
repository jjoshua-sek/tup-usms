"use client";

import { useTransition } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { requestIdValidation } from "@/app/(student)/id/actions";
import { Button } from "@/components/ui/button";

interface RequestValidationButtonProps {
  label?: string;
}

export function RequestValidationButton({
  label = "Request ID validation",
}: RequestValidationButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await requestIdValidation();
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Request sent.");
        })
      }
      className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <BadgeCheck className="mr-1.5 h-4 w-4" />
      )}
      {isPending ? "Sending…" : label}
    </Button>
  );
}
