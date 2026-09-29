import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import {
  ACTIVITY_COOKIE,
  countsAsActivity,
  encodeActivity,
  idleLimitMinutes,
  idleState,
  sessionIdFromAccessToken,
  sessionKindForRole,
} from "@/lib/auth/session-policy";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that don't require authentication. /auth/confirm is where a
// one-time sign-in link lands — by definition before the person has a
// session.
const PUBLIC_ROUTES = ["/login", "/reset-password", "/auth/callback", "/auth/confirm"];

/**
 * Routes called by machines rather than people. Each carries its own
 * authentication and must never see the Supabase session cookie dance:
 *   /kiosk              — unattended gate terminal; device key
 *   /api/access/        — gate endpoints; Bearer device key
 *   /api/notifications/ — the email dispatcher; Bearer CRON_SECRET, called
 *                         by pg_cron from Supabase (migration 00019 §6)
 *
 * These are checked before `updateSession()` so a caller with no cookies is
 * never redirected to /login. A cron job cannot follow a redirect to a login
 * form, so without this the queue silently stops draining.
 */
const MACHINE_ROUTES = ["/kiosk", "/api/access/", "/api/notifications/"];

// Student-facing route prefixes (OSA System).
const STUDENT_ROUTES = [
  "/dashboard",
  "/profile",
  "/concerns",
  "/messages",
  "/documents",
  "/violations",
  "/settings",
  "/id",
  "/appointments",
  "/notifications",
  "/scholarships",
  "/clearance",
  "/records",
  "/availability",
];

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((cookie) => /^sb-.+-auth-token/.test(cookie.name));
}

function loginUrl(request: NextRequest, params: Record<string, string>): URL {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

/**
 * Shown when Supabase could not be reached to check the session. Sending
 * the user to /login here is what produced redirect loops on a flaky
 * connection: the login page's own check might succeed a moment later and
 * send them back again. Saying so plainly, and letting them retry, doesn't.
 */
function unavailable(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Can't reach the sign-in service</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c1917">
<h1 style="font-size:1.25rem">Can't reach the sign-in service right now</h1>
<p style="color:#57534e;line-height:1.6">Your session couldn't be checked because the connection to the authentication server failed. You haven't been signed out. Check your internet connection, then try again.</p>
<button onclick="location.reload()" style="margin-top:1rem;padding:.55rem 1.1rem;border:0;border-radius:.4rem;background:#7a1f2b;color:#fff;font-size:.9rem;cursor:pointer">Try again</button>
</body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "5" } },
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (MACHINE_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const session = await updateSession(request);
  const { user } = session;
  const isApi = pathname.startsWith("/api/");
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // ---- Supabase unreachable ------------------------------------------
  // "Couldn't check" is not "not signed in". Treating it as signed out
  // bounced people between /login and their dashboard whenever the
  // connection to Supabase dropped for a moment.
  if (!user && session.error && isAuthRetryableFetchError(session.error) && hasSessionCookie(request)) {
    if (isPublic) return session.next();
    return isApi
      ? session.json({ error: "Could not reach the sign-in service. Try again." }, { status: 503 })
      : session.carry(unavailable());
  }

  // ---- Inactivity timeout --------------------------------------------
  // Enforced here as well as in the browser (components/auth/session-guard)
  // because the browser's timer does not run while a laptop is asleep or a
  // tab is suspended. Whatever the browser missed, the next request is
  // checked before it is served.
  let activityStamp: string | null = null;
  if (user) {
    const {
      data: { session: current },
    } = await session.supabase.auth.getSession();
    const sessionId = sessionIdFromAccessToken(current?.access_token);

    if (sessionId) {
      const now = Date.now();
      const limitMinutes = idleLimitMinutes(sessionKindForRole(user.app_metadata?.role));
      const state = idleState({
        cookie: request.cookies.get(ACTIVITY_COOKIE)?.value,
        sessionId,
        now,
        limitMinutes,
      });

      if (state === "expired") {
        // scope "local" revokes this sign-in at Supabase — its refresh token
        // can never be used again — without touching the user's sessions on
        // other devices. The cookie deletions it issues ride on the response.
        await session.supabase.auth.signOut({ scope: "local" });
        const ended = isApi
          ? session.json(
              { error: "Your session ended after a period of inactivity. Sign in again." },
              { status: 401 },
            )
          : session.redirect(loginUrl(request, { notice: "session-expired" }));
        ended.cookies.delete(ACTIVITY_COOKIE);
        return ended;
      }

      if (state === "fresh" || countsAsActivity(request)) {
        activityStamp = encodeActivity(sessionId, now);
      }
    }
  }

  const respond = (response: NextResponse) => {
    if (activityStamp) {
      response.cookies.set(ACTIVITY_COOKIE, activityStamp, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        // No Max-Age: like the auth cookies, it ends with the browser.
      });
    }
    return response;
  };

  // ---- Public routes -------------------------------------------------
  // A signed-in user may still open /login. It used to redirect them to
  // their dashboard, which made switching accounts impossible without
  // finding the sign-out button first — and fed the /login ⇄ /staff/dashboard
  // loop. The login page now offers to continue or sign out instead.
  if (isPublic) return respond(session.next());

  // ---- Not signed in -------------------------------------------------
  if (!user) {
    // A fetch() to an API gets a status it can act on, not a login page.
    if (isApi) return session.json({ error: "Sign in required." }, { status: 401 });
    return session.redirect(loginUrl(request, { redirect: pathname }));
  }

  // app_metadata is server-only. user_metadata is writable by the user via
  // the client SDK, so reading the role from there would let any student
  // claim to be staff — and (because the default kicks in) it also resolved
  // every real admin to "student".
  const role = user.app_metadata?.role || "student";
  const isStaff = role === "staff" || role === "admin";
  const isStaffArea = pathname === "/staff" || pathname.startsWith("/staff/");

  // Prevent students from accessing staff routes
  if (!isStaff && isStaffArea) {
    return respond(session.redirect(new URL("/dashboard", request.url)));
  }

  // Prevent staff from accessing student-specific routes (they have their own)
  if (
    isStaff &&
    !isStaffArea &&
    STUDENT_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))
  ) {
    return respond(session.redirect(new URL("/staff/dashboard", request.url)));
  }

  // Redirect root to appropriate dashboard
  if (pathname === "/") {
    return respond(session.redirect(new URL(isStaff ? "/staff/dashboard" : "/dashboard", request.url)));
  }

  return respond(session.next());
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
