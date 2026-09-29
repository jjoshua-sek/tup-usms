/**
 * When a signed-in session should end.
 *
 * Pure — no cookies read, no clock read — so the rules can be tested and so
 * the proxy (server) and SessionGuard (browser) apply the same ones.
 *
 * Supabase issues each sign-in its own session, with a short-lived access
 * token and a single-use refresh token, but on the free plan it never ends a
 * session for inactivity: left alone, a sign-in lasts until someone signs
 * out. On a shared or lab computer that means the next person inherits a
 * staff member's view of every student's disciplinary record. These rules
 * add the two limits a records system needs: idle time, and closing the site.
 */

export type SessionKind = "staff" | "student";

/**
 * Staff sessions expose other people's records, so they time out sooner
 * than a student's view of their own. Both are within the 15–30 minute idle
 * range OWASP ASVS gives for applications holding sensitive personal data.
 */
const DEFAULT_IDLE_MINUTES: Record<SessionKind, number> = { staff: 15, student: 30 };
const MIN_IDLE_MINUTES = 5;
const MAX_IDLE_MINUTES = 240;

export function sessionKindForRole(role: unknown): SessionKind {
  return role === "staff" || role === "admin" ? "staff" : "student";
}

/**
 * Minutes of inactivity before sign-out, from SESSION_IDLE_MINUTES_STAFF /
 * SESSION_IDLE_MINUTES_STUDENT. Clamped: under five minutes interrupts
 * someone reading a long case file; over four hours stops being a timeout.
 */
export function idleLimitMinutes(
  kind: SessionKind,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = kind === "staff" ? env.SESSION_IDLE_MINUTES_STAFF : env.SESSION_IDLE_MINUTES_STUDENT;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_IDLE_MINUTES[kind];
  return Math.min(Math.max(parsed, MIN_IDLE_MINUTES), MAX_IDLE_MINUTES);
}

// ============================================================
// SERVER: THE ACTIVITY STAMP
// ============================================================

/**
 * An httpOnly cookie holding "<session id>.<last activity, ms>".
 *
 * Bound to the Supabase session id so a stamp left behind by an earlier
 * sign-in — the previous person at a shared computer — can never extend a
 * new one: a stamp for a different session is simply ignored.
 *
 * Deliberately unsigned. The only thing a person gains by editing their own
 * stamp is keeping their own session alive, which is no different from
 * staying at the keyboard. The threat this defends against is someone else
 * sitting down at an abandoned session, and by then it is already expired.
 */
export const ACTIVITY_COOKIE = "usms_activity";

export function encodeActivity(sessionId: string, at: number): string {
  return `${sessionId}.${Math.floor(at)}`;
}

export function decodeActivity(value: string | null | undefined): { sessionId: string; at: number } | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const at = Number(value.slice(separator + 1));
  if (!Number.isFinite(at) || at <= 0) return null;
  return { sessionId: value.slice(0, separator), at };
}

export type IdleState = "fresh" | "active" | "expired";

/**
 * fresh   — no stamp for this session yet (just signed in): start tracking.
 * active  — within the limit.
 * expired — idle past the limit: the session must end before this request
 *           is served, whatever the request is.
 */
export function idleState(input: {
  cookie: string | null | undefined;
  sessionId: string;
  now: number;
  limitMinutes: number;
}): IdleState {
  const activity = decodeActivity(input.cookie);
  if (!activity || activity.sessionId !== input.sessionId) return "fresh";
  // A stamp from the future is a wrong clock or an edited cookie. Restart
  // tracking from now rather than honouring it indefinitely.
  if (activity.at > input.now + 60_000) return "fresh";
  if (input.now - activity.at > input.limitMinutes * 60_000) return "expired";
  return "active";
}

interface RequestLike {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}

export const HEARTBEAT_PATH = "/api/session/ping";

/**
 * Whether a request is the person doing something, as opposed to the app
 * doing something on its own.
 *
 * The distinction is the whole point. Next.js prefetches links in view and
 * realtime screens refresh themselves when data changes; if those counted,
 * a page left open on an unattended computer would keep its session alive
 * forever. Counted: full page loads, form submissions (server actions), and
 * the heartbeat SessionGuard sends only after real keyboard, mouse or touch
 * input.
 */
export function countsAsActivity(request: RequestLike): boolean {
  const headers = request.headers;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`;
  if (headers.get("next-router-prefetch") || /prefetch/i.test(purpose)) return false;

  if (request.nextUrl.pathname === HEARTBEAT_PATH) return true;
  if (headers.get("next-action")) return true;
  return headers.get("sec-fetch-mode") === "navigate";
}

/**
 * The session id inside a Supabase access token. Read without verifying the
 * signature: the proxy only calls this after getUser() has verified the very
 * same token with Supabase.
 */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id ? claims.session_id : null;
  } catch {
    return null;
  }
}
