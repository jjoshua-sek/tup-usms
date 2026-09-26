/**
 * GET /auth/confirm — where a one-time sign-in link lands.
 *
 * The invitation email carries ?token_hash=…&type=…, minted by
 * auth.admin.generateLink when the dispatcher sent it. verifyOtp exchanges
 * that for a session (set as cookies by the server client), and the student
 * is sent on to choose a password.
 *
 * A used, expired or tampered link lands on the login page with an
 * explanation, not an error screen: the fix is always the same — ask the
 * OSA to send a new one — and the student should be told so.
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** Only the link types this app issues. Anything else is not ours. */
const ACCEPTED: readonly EmailOtpType[] = ["magiclink", "email"];

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  // Rebuild the destination from scratch so the token never travels onward
  // in a query string, a Referer header or the browser history of /activate.
  const destination = request.nextUrl.clone();
  destination.search = "";

  if (tokenHash && type && ACCEPTED.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      destination.pathname = "/activate";
      return NextResponse.redirect(destination);
    }

    console.warn("[auth/confirm] link rejected:", error.message);
  }

  destination.pathname = "/login";
  destination.searchParams.set("notice", "link-expired");
  return NextResponse.redirect(destination);
}
