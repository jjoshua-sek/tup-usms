/**
 * POST /api/session/ping — "the person at this browser is still here".
 *
 * Sent by SessionGuard at most once a minute, and only after real keyboard,
 * mouse or touch input. The work happens in the proxy before this handler
 * runs: it refuses the request with 401 if the session has already expired,
 * and otherwise renews the activity stamp. Someone reading a long case file
 * without clicking a link is still active, and this is how the server finds
 * out.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function POST() {
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
