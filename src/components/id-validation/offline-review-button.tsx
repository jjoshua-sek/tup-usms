"use client";

import { useTransition } from "react";
import { CheckIcon as Check, CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { resolveOfflineReview } from "@/app/staff/id-validation/actions";
import { Button } from "@/components/ui/button";

/** Takes one record from the offline copy off the review list. */
export function OfflineReviewButton({ uploadId }: { uploadId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await resolveOfflineReview(formData);
          if (result.error) toast.error(result.error);
          else toast.success("Marked reviewed.");
        })
      }
    >
      <input type="hidden" name="upload_id" value={uploadId} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="h-8">
        {isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
        Mark reviewed
      </Button>
    </form>
  );
}
