"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, LogOut } from "lucide-react";

import { announceSignOut } from "@/components/auth/session-guard";
import { createClient } from "@/lib/supabase/client";

/**
 * What /login shows to someone who is already signed in.
 *
 * It used to redirect them to their dashboard, which left no way to reach
 * the login form to switch accounts — signing in as a test student while
 * signed in as admin meant hunting for the sign-out button first — and
 * which fed the /login ⇄ /staff/dashboard redirect loop.
 */
export function AlreadySignedIn({ loginId, destination }: { loginId: string; destination: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-6">
        <h3 className="mb-1.5 text-2xl font-semibold tracking-tight">You&apos;re already signed in</h3>
        <p className="text-[13px] text-muted-foreground">
          This browser is signed in as <span className="font-mono font-medium text-foreground">{loginId}</span>.
        </p>
      </div>

      <div className="space-y-2.5">
        <Link
          href={destination}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-tup-maroon-600 px-4 py-2 text-sm font-medium text-white hover:bg-tup-maroon-700"
        >
          Continue as {loginId}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await createClient().auth.signOut({ scope: "local" });
              announceSignOut();
              window.location.replace("/login");
            })
          }
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden="true" />
          )}
          Sign out and use another account
        </button>
      </div>
    </div>
  );
}
