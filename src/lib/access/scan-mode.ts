/**
 * How a gate kiosk reads IDs: the device's camera, or a USB scanner (a
 * keyboard wedge). Pure, so the choice can be tested; components/access/
 * kiosk.tsx reads and saves it.
 *
 * A phone used as the gate has no keyboard, so a scanner cannot be plugged
 * in: it starts on the camera. Whatever staff pick in the kiosk's settings is
 * saved on the device and wins from then on, so a reload during the day does
 * not put the gate back on the other one.
 */

/** Where the choice is saved, next to the device key and the copy's address. */
export const SCAN_MODE_KEY = "stars.gate.scanMode";

export type ScanMode = "camera" | "scanner";

/**
 * `touchOnly`: the device has a touchscreen and no mouse or trackpad, which
 * in practice means a phone or tablet without a keyboard attached.
 */
export function initialScanMode(saved: string | null, touchOnly: boolean): ScanMode {
  if (saved === "camera" || saved === "scanner") return saved;
  return touchOnly ? "camera" : "scanner";
}
