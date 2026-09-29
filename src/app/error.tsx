"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * The app-wide error screen. Before this there was none, so any error
 * reached Next.js's bare "Application error" page in production.
 *
 * What it can say depends on where the error came from:
 *
 *   - Refusals the proxy sends a form submission — signed out, signed in as
 *     someone else in another tab, server unreachable — arrive as a readable
 *     message and are shown as-is. They say what happened and that nothing
 *     was saved, which is exactly what the person needs.
 *   - Errors thrown while rendering on the server arrive in production with
 *     their message withheld and only a digest. Those get a generic line and
 *     the digest, which is what to quote when reporting it.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const readable = !error.digest && error.message ? error.message : null;

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <h1 className="font-display text-lg font-semibold">That didn&apos;t go through</h1>
        </div>

        <p className="mt-3 text-[14px] leading-relaxed">
          {readable ?? "Something went wrong on our side. Try again in a moment."}
        </p>

        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">Reference: {error.digest}</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-md bg-tup-maroon-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-tup-maroon-700"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload the page
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border px-3.5 py-2 text-sm hover:bg-muted"
          >
            Try again
          </button>
          <Link href="/login" className="rounded-md px-3.5 py-2 text-sm text-muted-foreground hover:bg-muted">
            Go to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
