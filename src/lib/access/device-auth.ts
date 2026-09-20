/**
 * Gate device credentials.
 *
 * A kiosk is an unattended browser at a turnstile: there is no human to log in
 * and no session to refresh. It authenticates with a long random device key
 * sent as `Authorization: Bearer usms_gate_...`.
 *
 * Only the SHA-256 of the key is stored (`access_gates.device_key_hash`), so a
 * leak of the database does not yield working gate credentials. The plaintext
 * is shown to staff exactly once, when the gate is created or its key rotated.
 *
 * SHA-256 rather than bcrypt/argon2 is deliberate here: the secret is 256 bits
 * of CSPRNG output, not a human password, so there is nothing to brute-force
 * and the lookup stays fast enough to sit in front of every single scan.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const GATE_KEY_PREFIX = "usms_gate_";

export interface GeneratedGateKey {
  /** Show once, never stored. */
  key: string;
  /** Stored in access_gates.device_key_hash. */
  hash: string;
  /** Stored for display, e.g. "usms_gate_9fQ2…" so staff can tell keys apart. */
  prefix: string;
}

export function generateGateKey(): GeneratedGateKey {
  const secret = randomBytes(32).toString("base64url");
  const key = `${GATE_KEY_PREFIX}${secret}`;

  return {
    key,
    hash: hashGateKey(key),
    prefix: `${GATE_KEY_PREFIX}${secret.slice(0, 6)}`,
  };
}

export function hashGateKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

/** Pulls the raw key out of an Authorization header, if it looks like one. */
export function extractBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  const key = match[1];
  if (!key.startsWith(GATE_KEY_PREFIX)) return null;
  if (key.length > 200) return null;
  return key;
}

/**
 * Constant-time comparison of two hex digests. The database lookup is by hash
 * equality already, but this is used where a candidate hash is compared in
 * application code.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
