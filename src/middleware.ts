import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/reset-password", "/auth/callback"];

// Role-based route prefixes
const STUDENT_ROUTES = [
  "/dashboard",
  "/profile",
  "/enrollment",
  "/schedule",
  "/grades",
  "/concerns",
  "/messages",
  "/documents",
  "/violations",
  "/evaluation",
  "/graduation",
  "/settings",
];

const STAFF_ROUTES = [
  "/staff/dashboard",
  "/staff/concerns",
  "/staff/violations",
  "/staff/scanner",
  "/staff/students",
  "/staff/messages",
  "/staff/calendar",
  "/staff/settings",
];

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);

  const { pathname } = request.nextUrl;

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

  const role = user.user_metadata?.role || "student";

  // Prevent students from accessing staff routes
  if (
    role === "student" &&
    STAFF_ROUTES.some((route) => pathname.startsWith(route))
  ) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Prevent staff from accessing student-specific routes (they have their own)
  if (
    (role === "staff" || role === "admin") &&
    STUDENT_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/")) &&
    !STAFF_ROUTES.some((route) => pathname.startsWith(route))
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
