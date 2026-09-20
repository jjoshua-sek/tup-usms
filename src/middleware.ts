import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/reset-password", "/auth/callback"];

/**
 * Routes that carry their own authentication and must never see the Supabase
 * session cookie dance:
 *   /kiosk       — unattended gate terminal; authenticates with a device key
 *   /api/access/ — gate endpoints; authenticate with a Bearer device key
 *
 * These are checked before `updateSession()` so a kiosk with no cookies is
 * never redirected to /login mid-scan.
 */
const DEVICE_ROUTES = ["/kiosk", "/api/access/"];

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (DEVICE_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const { user, supabaseResponse } = await updateSession(request);

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // If already authenticated, redirect away from login
    if (user && pathname === "/login") {
      // app_metadata is server-only (can't be self-modified by users via the SDK)
      const role = user.app_metadata?.role || "student";
      const redirectUrl =
        role === "staff" || role === "admin"
          ? "/staff/dashboard"
          : "/dashboard";
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }
    return supabaseResponse;
  }

  // Redirect unauthenticated users to login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // app_metadata is server-only. user_metadata is writable by the user via
  // the client SDK, so reading the role from there would let any student
  // claim to be staff — and (because the default kicks in) it also resolved
  // every real admin to "student".
  const role = user.app_metadata?.role || "student";
  const isStaffArea = pathname === "/staff" || pathname.startsWith("/staff/");

  // Prevent students from accessing staff routes
  if (role === "student" && isStaffArea) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Prevent staff from accessing student-specific routes (they have their own)
  if (
    (role === "staff" || role === "admin") &&
    !isStaffArea &&
    STUDENT_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    )
  ) {
    return NextResponse.redirect(new URL("/staff/dashboard", request.url));
  }

  // Redirect root to appropriate dashboard
  if (pathname === "/") {
    const redirectUrl =
      role === "staff" || role === "admin"
        ? "/staff/dashboard"
        : "/dashboard";
    return NextResponse.redirect(new URL(redirectUrl, request.url));
  }

  return supabaseResponse;
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
