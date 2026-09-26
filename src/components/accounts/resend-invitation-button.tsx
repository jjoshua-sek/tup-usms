"use client";

import { useTransition } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { resendInvitation } from "@/app/staff/accounts/actions";

/** Queues a fresh link; the new token replaces whatever was sent before. */
export function ResendInvitationButton({ invitationId }: { invitationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await resendInvitation(invitationId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Queued.");
        })
      }
      className="inline-flex items-center gap-1 text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
      Resend link
    </button>
  );
}
