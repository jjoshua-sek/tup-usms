/**
 * Authenticating a gate kiosk request.
 *
 * Kiosks present `Authorization: Bearer usms_gate_...`. We hash the presented
 * key and look the gate up by hash, so the plaintext key never has to be
 * stored or compared in the clear. An inactive gate still authenticates — the
 * verify path needs to log `gate_inactive` rather than silently drop the scan.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";

import { extractBearerKey, hashGateKey } from "./device-auth";
import type { AccessGate } from "./verify";

/** Discriminated on `gate`: null means "answer 401 with this message". */
export type GateAuthOutcome =
  | { gate: AccessGate }
  | { gate: null; message: string };

const GATE_COLUMNS =
  "id, code, name, location, direction_mode, enforcement_mode, anti_passback, relay_mode, relay_config, is_active";

export async function authenticateGateRequest(request: Request): Promise<GateAuthOutcome> {
  const key = extractBearerKey(request.headers.get("authorization"));
  if (!key) {
    return { gate: null, message: "Missing or malformed device key." };
  }

  const db = loose(createAdminClient());
  const { data } = await db
    .from("access_gates")
    .select(GATE_COLUMNS)
    .eq("device_key_hash", hashGateKey(key))
    .maybeSingle();

  const gate = (data as AccessGate | null) ?? null;
  if (!gate) {
    return { gate: null, message: "This device is not paired with a gate." };
  }

  return { gate };
}

/**
 * Records that a kiosk is alive. Best-effort: a failed heartbeat write must
 * never stop a student from getting through the turnstile.
 */
export async function touchGate(gateId: string, request: Request): Promise<void> {
  try {
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? null;

    const db = loose(createAdminClient());
    await db
      .from("access_gates")
      .update({
        last_seen_at: new Date().toISOString(),
        last_seen_ip: ip,
        kiosk_user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
      })
      .eq("id", gateId);
  } catch {
    // Intentionally swallowed — telemetry, not policy.
  }
}
