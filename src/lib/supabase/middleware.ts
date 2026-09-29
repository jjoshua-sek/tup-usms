import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { asSessionCookie } from "@/lib/auth/session-cookies";

interface PendingCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Verifies — and when needed refreshes — the Supabase session for one
 * request, and hands back helpers that build the proxy's response.
 *
 * Two bugs lived here, and together they explain redirect loops between
 * /login and /staff/dashboard:
 *
 *   1. The headers forwarded to the page were copied BEFORE the refresh,
 *      so after a refresh the proxy saw the new session while the page saw
 *      the old one. When they disagreed, the layout sent the user to /login
 *      and the proxy sent them straight back.
 *   2. Every redirect was a brand-new response, so a refresh that happened
 *      on a redirecting request never reached the browser. Refresh tokens
 *      are single-use; the browser kept the spent one, and its next request
 *      presented it again.
 *
 * Refreshed cookies are now collected as they are issued and applied by
 * next(), redirect() and json() alike, at the moment the response is built.
 */
export async function updateSession(request: NextRequest) {
  const pending = new Map<string, PendingCookie>();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            // Update the request too, so the page this request continues to
            // reads the refreshed session rather than the one it arrived with.
            request.cookies.set(name, value);
            // Session cookies: the sign-in ends when the browser closes.
            pending.set(name, { name, value, options: asSessionCookie(options) });
          }
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  /** Applies every cookie issued during this request to a response. */
  function carry<T extends NextResponse>(response: T): T {
    for (const cookie of pending.values()) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  }

  return {
    supabase,
    user,
    error,
    carry,
    /**
     * Continue to the page. The forwarded headers are built now, not at the
     * top of the request, so they include anything refreshed since.
     */
    next() {
      const headers = new Headers(request.headers);
      // Read by the student layout's profile-completion gate.
      headers.set("x-pathname", request.nextUrl.pathname);
      return carry(NextResponse.next({ request: { headers } }));
    },
    redirect(url: URL | string) {
      return carry(NextResponse.redirect(url));
    },
    json(body: unknown, init?: ResponseInit) {
      return carry(NextResponse.json(body, init));
    },
  };
}
