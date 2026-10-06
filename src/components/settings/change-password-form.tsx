"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { changePassword } from "@/lib/accounts/account-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RULES = ["At least 8 characters", "An uppercase letter", "A number", "A symbol, such as ! @ # $"];

/** Change the signed-in user's own password; the current one is required. */
export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const type = visible ? "text" : "password";

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const result = await changePassword(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Password changed.");
          formRef.current?.reset();
        })
      }
      className="max-w-sm space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="current_password">Current password</Label>
        <Input
          id="current_password"
          name="current_password"
          type={type}
          autoComplete="current-password"
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new_password">New password</Label>
        <div className="relative">
          <Input
            id="new_password"
            name="password"
            type={type}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            disabled={isPending}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? "Hide passwords" : "Show passwords"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password">Type the new password again</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type={type}
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          disabled={isPending}
        />
      </div>

      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {RULES.map((rule) => (
          <li key={rule}>· {rule}</li>
        ))}
      </ul>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}
        Change password
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Changing it signs you out on every other device.
      </p>
    </form>
  );
}
