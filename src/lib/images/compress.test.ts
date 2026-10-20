import { describe, expect, it } from "vitest";

import { DOCUMENT_TARGET, MAX_UPLOAD_BYTES, PHOTO_TARGET, formatBytes, jpegName, scaledSize } from "./compress";

describe("scaledSize", () => {
  it("shrinks the longer side to the limit and keeps the shape", () => {
    expect(scaledSize(4032, 3024, 2200)).toEqual({ width: 2200, height: 1650 });
    expect(scaledSize(3024, 4032, 800)).toEqual({ width: 600, height: 800 });
  });

  it("never enlarges a small image", () => {
    expect(scaledSize(640, 480, 2200)).toEqual({ width: 640, height: 480 });
  });
});

describe("jpegName", () => {
  it("swaps the extension for .jpg", () => {
    expect(jpegName("COR scan.PNG")).toBe("COR scan.jpg");
    expect(jpegName("rating.slip.webp")).toBe("rating.slip.jpg");
    expect(jpegName(".png")).toBe("photo.jpg");
  });
});

describe("targets", () => {
  // Compression aims well under the upload cap, so a compressed photo is
  // never the thing the cap turns away.
  it("aim below the 5 MB upload cap", () => {
    expect(PHOTO_TARGET.maxBytes).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(DOCUMENT_TARGET.maxBytes).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it("formats sizes for students", () => {
    expect(formatBytes(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatBytes(180 * 1024)).toBe("180 KB");
  });
});
