/**
 * Where a gate kiosk sends its scans: the cloud first, then the OSA's
 * offline LAN copy (offline fallback plan, Phase 2). Pure, so the order
 * and the timeouts can be tested; components/access/kiosk.tsx uses them.
 *
 * The kiosk page can be opened from either place, which is why both ends
 * answer cross-origin requests (the device key, not a cookie, is the
 * credential):
 *
 *   from the cloud   the cloud is this origin; the copy's address is set
 *                    once on the kiosk (Settings → Offline copy address)
 *   from the copy    the copy is this origin; the cloud's address is built
 *                    into the copy (NEXT_PUBLIC_CLOUD_APP_URL)
 *
 * The same device key works at both: the copy holds a copy of the gates.
 */

/**
 * How long to wait for the cloud before trying the copy. Long enough for a
 * cold start on Vercel's free plan (2–4 s); at 3 s a first scan after a quiet
 * spell went to the copy while the cloud was still answering it.
 */
export const CLOUD_TIMEOUT_WITH_FALLBACK_MS = 5_000;
/** With nowhere else to go, wait longer before showing "Gate offline". */
export const SOLE_TIMEOUT_MS = 8_000;
/** After the cloud fails, go straight to the copy for this long, so each scan does not wait for it. */
export const FALLBACK_STICKY_MS = 60_000;

export type Endpoint = "cloud" | "lan";

export interface KioskBases {
  /** "" means this page's own origin. Null: not available. */
  cloud: string | null;
  lan: string | null;
}

/**
 * The two addresses. `cloudAppUrl` is set only in the copy's build;
 * `savedLanUrl` is what the kiosk was given in its settings.
 */
export function kioskBases(cloudAppUrl: string | undefined, savedLanUrl: string | null): KioskBases {
  const builtIntoCopy = Boolean(cloudAppUrl?.trim());
  return builtIntoCopy
    ? { cloud: cloudAppUrl!.trim().replace(/\/$/, ""), lan: "" }
    : { cloud: "", lan: savedLanUrl };
}

/** Which to try, in order, and how long to wait for each. */
export function attemptOrder(
  bases: KioskBases,
  cloudFailedAt: number | null,
  now: number,
): Array<{ endpoint: Endpoint; timeoutMs: number }> {
  const hasLan = bases.lan !== null;
  const hasCloud = bases.cloud !== null;
  const cloudResting = cloudFailedAt !== null && now - cloudFailedAt < FALLBACK_STICKY_MS;

  const cloud = { endpoint: "cloud" as const, timeoutMs: hasLan ? CLOUD_TIMEOUT_WITH_FALLBACK_MS : SOLE_TIMEOUT_MS };
  const lan = { endpoint: "lan" as const, timeoutMs: SOLE_TIMEOUT_MS };

  if (hasCloud && hasLan) return cloudResting ? [lan, cloud] : [cloud, lan];
  if (hasCloud) return [{ ...cloud, timeoutMs: SOLE_TIMEOUT_MS }];
  if (hasLan) return [lan];
  return [];
}

/** An answer worth showing; anything else means "try the other one". */
export function isUsableResponse(status: number): boolean {
  return status < 500;
}

/**
 * "192.168.137.1" or "https://192.168.137.1/" → "https://192.168.137.1".
 * Null when it is not an address the kiosk can use. Only https: browsers
 * would block a secure kiosk page from calling plain http, and the camera
 * needs https anyway.
 */
export function normalizeLanUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}
