/**
 * Gate facts shared by the Gates & Access page (a server component) and the
 * gate console (a client component). Kept out of the "use client" module:
 * the server cannot call a function exported from one, and doing so crashed
 * the page the moment the first gate existed.
 */

/** A kiosk that hasn't checked in for three heartbeats is presumed down. */
export const ONLINE_WINDOW_MS = 3 * 60_000;

export function isGateOnline(lastSeenAt: string | null, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/**
 * What the console shows about each gate. Never `*`: that would send the
 * device key's hash to every staff browser.
 */
export const GATE_CONSOLE_COLUMNS =
  "id, code, name, location, direction_mode, enforcement_mode, anti_passback, relay_mode, relay_config, device_key_prefix, last_seen_at, is_active";
