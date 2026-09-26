"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { activateAccount } from "@/app/(auth)/activate/actions";
import { Button } from "@/components/ui/button";

const RULES = [
  "At least 8 characters",
  "An uppercase letter",
  "A number",
  "A symbol, such as ! @ # $",
];

/**
 * First-password form for an account created from the enrollment list.
 * Shown once, straight after the student follows their one-time link.
 */
export function ActivateForm({
  firstName,
  studentNumber,
}: {
  firstName: string;
  studentNumber: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-8">
        <h3 className="mb-1.5 text-2xl font-semibold tracking-tight">Welcome, {firstName}</h3>
        <p className="text-sm text-muted-foreground">
          Choose a password for your account. You&apos;ll sign in with it and your student number.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Student number
        </p>
        <p className="font-mono text-sm font-medium">{studentNumber}</p>
      </div>

      <form
        action={(formData) =>
          startTransition(async () => {
            // On success the action redirects to /profile and never returns.
            const result = await activateAccount(formData);
            if (result?.error) toast.error(result.error);
          })
        }
        className="space-y-4"
      >
        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium">New password</span>
          <span className="relative block">
            <input
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={72}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setVisible((value) => !value)}
              aria-label={visible ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>

        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium">Type it again</span>
          <input
            name="confirm_password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            className={inputClass}
          />
        </label>

        <ul className="space-y-0.5 text-[12px] text-muted-foreground">
          {RULES.map((rule) => (
            <li key={rule}>· {rule}</li>
          ))}
        </ul>

        <Button
          type="submit"
          disabled={isPending}
          className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="mr-1.5 h-4 w-4" />
          )}
          Save password and continue
        </Button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm focus:border-tup-maroon-600 focus:outline-none";
