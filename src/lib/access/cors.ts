import { NextResponse } from "next/server";

/**
 * Cross-origin access for the two gate endpoints (verify, heartbeat).
 *
 * A kiosk page opened from the cloud calls the OSA's offline copy when the
 * cloud does not answer, and one opened from the copy tries the cloud
 * first (lib/access/kiosk-endpoints.ts). Any origin may call: the
 * credential is the device key in the Authorization header, never a
 * cookie, so a page elsewhere gains nothing a stolen key would not already
 * give it.
 *
 * Allow-Private-Network answers Chrome's check before a public site may
 * call a private address such as 192.168.137.1. Chrome may also ask the
 * person at the kiosk once to allow access to the local network.
 */
export const GATE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Private-Network": "true",
  "Access-Control-Max-Age": "600",
} as const;

/** The preflight a browser sends before the real request. */
export function gatePreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: GATE_CORS_HEADERS });
}
