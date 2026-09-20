/**
 * POST /api/access/heartbeat — kiosk check-in.
 *
 * Serves two purposes:
 *   1. The kiosk pulls its current configuration, so flipping a gate from
 *      monitor to enforce (or deactivating a lane) takes effect within a
 *      minute without anyone walking to the terminal.
 *   2. `last_seen_at` powers the "online / offline" light on /staff/gates —
 *      a turnstile whose kiosk died is a turnstile nobody is checking.
 */

import { NextResponse } from "next/server";

import { authenticateGateRequest, touchGate } from "@/lib/access/gate-request";
import { getCurrentTerm } from "@/lib/access/term";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export async function POST(request: Request) {
  const auth = await authenticateGateRequest(request);
  if (auth.gate === null) {
    return NextResponse.json({ error: auth.message }, { status: 401, headers: NO_STORE });
  }

  await touchGate(auth.gate.id, request);

  return NextResponse.json(
    {
      gate: auth.gate,
      term: getCurrentTerm(),
      serverTime: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
