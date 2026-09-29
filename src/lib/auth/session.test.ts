import { describe, expect, it } from "vitest";

import { asSessionCookie, parseCookieHeader, serializeCookie } from "./session-cookies";
import {
  countsAsActivity,
  decodeActivity,
  encodeActivity,
  idleLimitMinutes,
  idleState,
  sessionIdFromAccessToken,
  sessionKindForRole,
} from "./session-policy";

const MINUTE = 60_000;
const SESSION = "5a1f0c3e-7b2d-4c1e-9f00-1234567890ab";

describe("idle limits", () => {
  it("defaults to 15 minutes for staff and 30 for students", () => {
    expect(idleLimitMinutes("staff", {})).toBe(15);
    expect(idleLimitMinutes("student", {})).toBe(30);
  });

  it("reads the configured value, clamped to 5–240", () => {
    expect(idleLimitMinutes("staff", { SESSION_IDLE_MINUTES_STAFF: "10" })).toBe(10);
    expect(idleLimitMinutes("staff", { SESSION_IDLE_MINUTES_STAFF: "1" })).toBe(5);
    expect(idleLimitMinutes("student", { SESSION_IDLE_MINUTES_STUDENT: "9999" })).toBe(240);
    expect(idleLimitMinutes("student", { SESSION_IDLE_MINUTES_STUDENT: "soon" })).toBe(30);
  });

  it("treats admins as staff and anything else as a student", () => {
    expect(sessionKindForRole("admin")).toBe("staff");
    expect(sessionKindForRole("staff")).toBe("staff");
    expect(sessionKindForRole("student")).toBe("student");
    expect(sessionKindForRole(undefined)).toBe("student");
  });
});

describe("idleState", () => {
  const now = Date.UTC(2026, 8, 30, 2, 0);
  const stamp = (minutesAgo: number, session = SESSION) => encodeActivity(session, now - minutesAgo * MINUTE);

  it("starts tracking a session it has not seen", () => {
    expect(idleState({ cookie: undefined, sessionId: SESSION, now, limitMinutes: 15 })).toBe("fresh");
  });

  it("keeps a session that has been active recently", () => {
    expect(idleState({ cookie: stamp(14), sessionId: SESSION, now, limitMinutes: 15 })).toBe("active");
  });

  it("ends a session idle past the limit", () => {
    expect(idleState({ cookie: stamp(16), sessionId: SESSION, now, limitMinutes: 15 })).toBe("expired");
  });

  // The previous person at a shared computer must not donate their recent
  // activity to whoever signs in next.
  it("ignores a stamp left by a different session", () => {
    const other = stamp(1, "11111111-2222-3333-4444-555555555555");
    expect(idleState({ cookie: other, sessionId: SESSION, now, limitMinutes: 15 })).toBe("fresh");
  });

  it("does not honour a stamp from the future", () => {
    expect(idleState({ cookie: stamp(-600), sessionId: SESSION, now, limitMinutes: 15 })).toBe("fresh");
  });

  it("round-trips the stamp and rejects garbage", () => {
    expect(decodeActivity(encodeActivity(SESSION, 1234))).toEqual({ sessionId: SESSION, at: 1234 });
    expect(decodeActivity("nonsense")).toBeNull();
    expect(decodeActivity(`${SESSION}.abc`)).toBeNull();
  });
});

describe("countsAsActivity", () => {
  const request = (pathname: string, headers: Record<string, string> = {}, method = "GET") => ({
    method,
    nextUrl: { pathname },
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it("counts page loads, form submissions and the heartbeat", () => {
    expect(countsAsActivity(request("/staff/cases", { "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(countsAsActivity(request("/staff/cases", { "next-action": "abc123" }, "POST"))).toBe(true);
    expect(countsAsActivity(request("/api/session/ping", {}, "POST"))).toBe(true);
  });

  // Otherwise a page left open with links in view would keep its session
  // alive indefinitely on an empty desk.
  it("does not count prefetches or the app refreshing itself", () => {
    expect(countsAsActivity(request("/staff/cases", { "next-router-prefetch": "1" }))).toBe(false);
    expect(countsAsActivity(request("/staff/cases", { "sec-purpose": "prefetch", "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(countsAsActivity(request("/staff/cases", { rsc: "1", "sec-fetch-mode": "cors" }))).toBe(false);
  });
});

describe("sessionIdFromAccessToken", () => {
  const token = (claims: object) =>
    ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

  it("reads the session id claim", () => {
    expect(sessionIdFromAccessToken(token({ sub: "x", session_id: SESSION }))).toBe(SESSION);
  });

  it("returns null for anything that is not a usable token", () => {
    expect(sessionIdFromAccessToken(token({ sub: "x" }))).toBeNull();
    expect(sessionIdFromAccessToken("not-a-token")).toBeNull();
    expect(sessionIdFromAccessToken(undefined)).toBeNull();
  });
});

describe("session cookies", () => {
  it("removes the lifetime so the cookie ends with the browser", () => {
    expect(asSessionCookie({ path: "/", sameSite: "lax", maxAge: 34560000 })).toEqual({ path: "/", sameSite: "lax" });
  });

  // Stripping Max-Age from a deletion would turn "delete this" into
  // "keep it until the browser closes" — signing out would stop working.
  it("leaves deletions untouched", () => {
    expect(asSessionCookie({ path: "/", maxAge: 0 })).toEqual({ path: "/", maxAge: 0 });
  });

  it("writes a session cookie with no Max-Age, and a deletion with Max-Age=0", () => {
    const set = serializeCookie("sb-x-auth-token", "base64-abc", asSessionCookie({ path: "/", sameSite: "lax", maxAge: 400 }));
    expect(set).toBe("sb-x-auth-token=base64-abc; Path=/; SameSite=Lax");

    expect(serializeCookie("sb-x-auth-token", "", { path: "/", maxAge: 0 })).toContain("Max-Age=0");
  });

  it("reads back what it writes", () => {
    expect(parseCookieHeader("a=1; sb-x-auth-token=base64-abc%3D; empty=")).toEqual([
      { name: "a", value: "1" },
      { name: "sb-x-auth-token", value: "base64-abc=" },
      { name: "empty", value: "" },
    ]);
  });
});
