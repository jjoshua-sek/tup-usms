import { describe, expect, it } from "vitest";

import { isOfflineMode, offlineAllowsApi, offlineBannerState } from "./mode";

describe("isOfflineMode", () => {
  it("is on only when STARS_OFFLINE is true", () => {
    expect(isOfflineMode({})).toBe(false);
    expect(isOfflineMode({ STARS_OFFLINE: "false" })).toBe(false);
    expect(isOfflineMode({ STARS_OFFLINE: " TRUE " })).toBe(true);
  });
});

describe("offlineAllowsApi", () => {
  it("lets reads and the session keep-alive through, and refuses writes", () => {
    expect(offlineAllowsApi("GET", "/api/files/upload")).toBe(true);
    expect(offlineAllowsApi("POST", "/api/session/ping")).toBe(true);
    expect(offlineAllowsApi("POST", "/api/files/upload")).toBe(false);
  });
});

describe("offlineBannerState", () => {
  // 10:42 AM in Manila on October 20, 2026.
  const refreshed = new Date("2026-10-20T02:42:00Z");

  it("shows the time of the last refresh, in Manila time", () => {
    const state = offlineBannerState(refreshed, new Date("2026-10-20T02:50:00Z"));
    expect(state.stale).toBe(false);
    expect(state.asOf).toMatch(/^records as of 10:42\s?AM$/i);
  });

  it("turns stale after an hour, and names the day once it is not today", () => {
    expect(offlineBannerState(refreshed, new Date("2026-10-20T03:43:00Z")).stale).toBe(true);
    const nextDay = offlineBannerState(refreshed, new Date("2026-10-21T01:00:00Z"));
    expect(nextDay.asOf).toMatch(/Oct 20/);
    expect(nextDay.stale).toBe(true);
  });

  it("is stale when the copy has never been refreshed", () => {
    expect(offlineBannerState(null, refreshed)).toEqual({ asOf: "records not yet copied", stale: true });
  });
});
