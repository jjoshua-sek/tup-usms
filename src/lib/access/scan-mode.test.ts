import { describe, expect, it } from "vitest";

import { initialScanMode } from "./scan-mode";

describe("initialScanMode", () => {
  it("starts a phone on the camera and a PC on the USB scanner", () => {
    expect(initialScanMode(null, true)).toBe("camera");
    expect(initialScanMode(null, false)).toBe("scanner");
  });

  it("keeps what staff chose on this device, either way", () => {
    expect(initialScanMode("scanner", true)).toBe("scanner");
    expect(initialScanMode("camera", false)).toBe("camera");
  });

  it("ignores a saved value it does not know", () => {
    expect(initialScanMode("webcam", true)).toBe("camera");
    expect(initialScanMode("", false)).toBe("scanner");
  });
});
