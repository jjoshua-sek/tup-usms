/**
 * POST /api/access/verify — the turnstile endpoint.
 *
 * Called by the gate kiosk once per scan. Authenticated by device key, not by
 * a user session (see `src/middleware.ts`, which lets /api/access/ through
 * untouched so no cookie refresh happens on this hot path).
 *
 * Response is intentionally minimal: a verdict, a headline, and — only when
 * the scan is allowed — a short name, masked number and photo so the guard can
 * match the face to the card.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateGateRequest, touchGate } from "@/lib/access/gate-request";
import { verifyScan } from "@/lib/access/verify";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const bodySchema = z.object({
  payload: z.string().min(1, { message: "Nothing was scanned." }).max(256),
  direction: z.enum(["entry", "exit"]).optional(),
});

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export async function POST(request: Request) {
  const startedAt = Date.now();

  const auth = await authenticateGateRequest(request);
  if (auth.gate === null) {
    return NextResponse.json(
      { error: auth.message },
      { status: 401, headers: NO_STORE },
    );
  }
  const gate = auth.gate;

  // A busy lane peaks around one scan per second. 240/min leaves headroom for
  // double-taps while still stopping a stolen key from being used to enumerate
  // student numbers.
  const limit = checkRateLimit({
    identifier: `access-verify:${gate.id}`,
    maxRequests: 240,
    windowSeconds: 60,
  });
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many scans from this gate. Please wait a moment." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "10" } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await verifyScan({
      payload: parsed.data.payload,
      gate,
      context: "turnstile",
      direction:
        parsed.data.direction ??
        (gate.direction_mode === "exit" ? "exit" : "entry"),
      startedAt,
    });

    void touchGate(gate.id, request);

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error("[access/verify] failed", error);
    // Fail closed: on an unexpected error the arm stays shut and the guard
    // falls back to visual inspection.
    return NextResponse.json(
      {
        decision: "deny",
        reason: "unreadable",
        gateOpened: false,
        enforced: true,
        headline: "System error",
        hint: "Please see the guard on duty.",
        tone: "warning",
        student: null,
        eventId: null,
        anomalyFlagged: false,
        termLabel: "",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
