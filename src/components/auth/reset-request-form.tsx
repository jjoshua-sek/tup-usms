"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";

import { requestPasswordReset } from "@/app/(auth)/reset-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Asks for the student number and the email the account's sign-in link was
 * sent to. The answer is the same whether or not they match a record, so
 * the confirmation is worded as "if", not "we sent".
 */
export function ResetRequestForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="w-full max-w-sm mx-auto">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-tup-maroon-600/10 text-tup-maroon-600">
          <MailCheck className="h-5 w-5" />
        </div>
        <h3 className="text-2xl font-semibold tracking-tight mb-1.5">Check your email</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          If the student number and email match our records, a link to choose a new password is on its way to
          that address. It can take a few minutes, works once, and expires after a short time.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Your current password keeps working until you use the link. If nothing arrives, check your spam folder,
          then ask the Office of Student Affairs to send one.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-[13px] font-medium text-tup-maroon-600 hover:underline"
        >
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="mb-8">
        <h3 className="text-2xl font-semibold tracking-tight mb-1.5">Reset your password</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Enter your student number and the personal email your sign-in link was sent to. We&apos;ll email a
          link to choose a new password.
        </p>
      </div>

      <form
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            const result = await requestPasswordReset(formData);
            if (result.error) setError(result.error);
            else setSubmitted(true);
          })
        }
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="login_id" className="text-[12px] font-medium">
            Student Number
          </Label>
          <Input
            id="login_id"
            name="login_id"
            placeholder="TUPM-22-0000"
            autoComplete="username"
            required
            disabled={isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[12px] font-medium">
            Personal email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="The address your sign-in link went to"
            autoComplete="email"
            required
            disabled={isPending}
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full bg-tup-maroon-600 hover:bg-tup-maroon-700 text-white"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Email me a reset link"
          )}
        </Button>
      </form>

      <p className="mt-6 text-[12px] leading-relaxed text-muted-foreground">
        Staff accounts: ask the administrator to send a reset link.{" "}
        <Link href="/login" className="font-medium text-tup-maroon-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
