import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback handler for Supabase.
 * Handles the redirect after email verification, password reset,
 * or OAuth sign-in (if added later).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check user role to redirect appropriately
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const role = user?.user_metadata?.role || "student";
      const redirectTo =
        role === "staff" || role === "admin"
          ? "/staff/dashboard"
          : next;

      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // Auth error — redirect to login with error message
  return NextResponse.redirect(
    `${origin}/login?error=auth_callback_failed`
  );
}
