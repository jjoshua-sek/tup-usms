"use client";

import { useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { sendPasswordReset } from "@/app/staff/accounts/actions";

/**
 * For a student who has set up their account and forgotten the password.
 * Safe to send: their current password keeps working until the link is used.
 */
export function ResetPasswordButton({ invitationId }: { invitationId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendPasswordReset(invitationId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Reset link queued.");
        })
      }
      className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline disabled:opacity-50"
    >
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
      Send password reset link
    </button>
  );
}
