/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * Supabase's free plan holds 1 GB of files, and a phone photo of a COR is
 * often 3–5 MB, so unshrunk uploads would fill it with a few hundred
 * documents. A 2,200-pixel JPEG keeps every printed figure legible (for staff
 * and for the AI) at about a third of the size; a profile photo only needs
 * to look right on the gate kiosk and the student record.
 *
 * PDFs and anything the browser cannot decode pass through unchanged; the
 * upload's own size limit still applies to them.
 */

export interface CompressTarget {
  /** Longest side, in pixels, after shrinking. */
  maxDimension: number;
  /** Aim for a file at most this large. */
  maxBytes: number;
}

/** Profile photos: shown small on the kiosk and the student record. */
export const PHOTO_TARGET: CompressTarget = { maxDimension: 800, maxBytes: 200 * 1024 };

/** CORs, rating slips, signed apology letters: text must stay readable. */
export const DOCUMENT_TARGET: CompressTarget = { maxDimension: 2200, maxBytes: 1.5 * 1024 * 1024 };

/**
 * A counter photo of a stamped COR or rating slip. It goes through a Server
 * Action (1 MB body cap), so it is kept under 900 KB; 2000 px still leaves
 * every grade and the stamps legible.
 */
export const SCAN_TARGET: CompressTarget = { maxDimension: 2000, maxBytes: 900 * 1024 };

/** The largest file any STARS upload accepts, after compression. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const QUALITIES = [0.85, 0.75, 0.65, 0.55];

/** Width and height scaled down so the longer side is at most `max`; never scaled up. */
export function scaledSize(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** "COR scan.PNG" → "COR scan.jpg" */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

/** "4.2 MB", "180 KB": for messages to students. */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function compressImage(file: File, target: CompressTarget): Promise<File> {
  if (!COMPRESSIBLE.has(file.type) || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    // Phone cameras store rotation as metadata; this draws the photo upright.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    if (file.size <= target.maxBytes && Math.max(bitmap.width, bitmap.height) <= target.maxDimension) return file;

    let { width, height } = scaledSize(bitmap.width, bitmap.height, target.maxDimension);
    let best: Blob | null = null;

    // Lower the quality first; if that is not enough, shrink and try again.
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const quality of QUALITIES) {
        const blob = await encodeJpeg(bitmap, width, height, quality);
        if (!blob) return file;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= target.maxBytes) {
          return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
        }
      }
      ({ width, height } = scaledSize(width, height, Math.round(Math.max(width, height) * 0.8)));
    }

    // Still above the aim: keep the smallest version, if it beats the original.
    return best && best.size < file.size
      ? new File([best], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() })
      : file;
  } finally {
    bitmap.close();
  }
}

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // JPEG has no transparency: a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
