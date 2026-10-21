import { describe, expect, it } from "vitest";

import {
  CLOUD_TIMEOUT_WITH_FALLBACK_MS,
  FALLBACK_STICKY_MS,
  SOLE_TIMEOUT_MS,
  attemptOrder,
  isUsableResponse,
  kioskBases,
  normalizeLanUrl,
} from "./kiosk-endpoints";

describe("kioskBases", () => {
  it("on the cloud: the cloud is this page; the copy is what the kiosk was given", () => {
    expect(kioskBases(undefined, "https://192.168.137.1")).toEqual({ cloud: "", lan: "https://192.168.137.1" });
    expect(kioskBases("", null)).toEqual({ cloud: "", lan: null });
  });

  it("on the copy: the copy is this page; the cloud is built in", () => {
    expect(kioskBases("https://tup-usms.vercel.app/", "https://ignored")).toEqual({ cloud: "https://tup-usms.vercel.app", lan: "" });
  });
});

describe("attemptOrder", () => {
  const both = { cloud: "", lan: "https://192.168.137.1" };
  const now = 1_000_000;

  it("tries the cloud first, briefly, when there is a copy to fall back on", () => {
    expect(attemptOrder(both, null, now)).toEqual([
      { endpoint: "cloud", timeoutMs: CLOUD_TIMEOUT_WITH_FALLBACK_MS },
      { endpoint: "lan", timeoutMs: SOLE_TIMEOUT_MS },
    ]);
  });

  // Otherwise every scan in an outage would wait three seconds for nothing.
  it("goes straight to the copy for a minute after the cloud fails, then tries the cloud again", () => {
    expect(attemptOrder(both, now - 5_000, now).map((a) => a.endpoint)).toEqual(["lan", "cloud"]);
    expect(attemptOrder(both, now - FALLBACK_STICKY_MS - 1, now).map((a) => a.endpoint)).toEqual(["cloud", "lan"]);
  });

  it("waits longer when there is nowhere else to go", () => {
    expect(attemptOrder({ cloud: "", lan: null }, null, now)).toEqual([{ endpoint: "cloud", timeoutMs: SOLE_TIMEOUT_MS }]);
  });
});

describe("isUsableResponse", () => {
  // A rejected device key is an answer; a server error is not.
  it("falls back on server errors only", () => {
    expect(isUsableResponse(200)).toBe(true);
    expect(isUsableResponse(401)).toBe(true);
    expect(isUsableResponse(503)).toBe(false);
  });
});

describe("normalizeLanUrl", () => {
  it("accepts an address with or without https://, and keeps only the origin", () => {
    expect(normalizeLanUrl("192.168.137.1")).toBe("https://192.168.137.1");
    expect(normalizeLanUrl(" https://192.168.137.1/kiosk ")).toBe("https://192.168.137.1");
  });

  it("refuses plain http and nonsense", () => {
    expect(normalizeLanUrl("http://192.168.137.1")).toBeNull();
    expect(normalizeLanUrl("")).toBeNull();
    expect(normalizeLanUrl("https://")).toBeNull();
  });
});
