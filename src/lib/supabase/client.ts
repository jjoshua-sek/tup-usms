import { createBrowserClient } from "@supabase/ssr";

import { asSessionCookie, parseCookieHeader, serializeCookie } from "@/lib/auth/session-cookies";
import type { Database } from "@/types/database";

/**
 * Creates a Supabase client for use in Client Components.
 * Used in hooks, forms, and realtime subscriptions.
 * This client respects RLS policies based on the current user's JWT.
 *
 * Cookie handling is supplied here rather than left to the library, for one
 * reason: the library writes auth cookies with a 400-day lifetime and cannot
 * be told otherwise. Signing in happens in the browser, so without this the
 * very first session cookie would outlive the browser. These are session
 * cookies — closing the browser signs the user out.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Client components also render once on the server, where there is
          // no document to read.
          if (typeof document === "undefined") return [];
          return parseCookieHeader(document.cookie);
        },
        setAll(cookiesToSet) {
          if (typeof document === "undefined") return;
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookie(name, value, asSessionCookie(options));
          }
        },
      },
    }
  );
}
