"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateGateKey } from "@/lib/access/device-auth";
import { getAccessStaff } from "@/lib/access/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";

/**
 * Gate administration.
 *
 * Writes go through the service-role client *after* an explicit role check,
 * because creating a gate also mints a device credential — something RLS
 * alone can't express cleanly. The plaintext key is returned exactly once and
 * never stored; only its SHA-256 lands in the database.
 */

interface GateActionResult {
  error?: string;
  ok?: boolean;
  /** Present only on create / rotate. Show once, then it's gone forever. */
  deviceKey?: string;
  gateId?: string;
}

const gateSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, {
      message: "Use letters, numbers and dashes, e.g. MAIN-ENTRY.",
    }),
  name: z.string().trim().min(2, { message: "Give the gate a name." }).max(80),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  direction_mode: z.enum(["entry", "exit", "bidirectional"]),
  enforcement_mode: z.enum(["monitor", "enforce"]),
  anti_passback: z.enum(["off", "soft", "hard"]),
  relay_mode: z.enum(["none", "local_http", "web_serial"]),
  relay_url: z.string().trim().max(200).optional().or(z.literal("")),
  open_command: z.string().trim().max(120).optional().or(z.literal("")),
  close_command: z.string().trim().max(120).optional().or(z.literal("")),
  pulse_ms: z.coerce.number().int().min(100).max(5000).optional(),
});

function buildRelayConfig(input: z.infer<typeof gateSchema>): Record<string, unknown> {
  if (input.relay_mode === "local_http") {
    return { url: input.relay_url || "" };
  }
  if (input.relay_mode === "web_serial") {
    return {
      open_command: input.open_command || "",
      close_command: input.close_command || "",
      pulse_ms: input.pulse_ms ?? 600,
    };
  }
  return {};
}

function readGateForm(formData: FormData) {
  // An untouched number input posts "", which z.coerce would turn into 0 and
  // then reject against min(100) with a confusing message.
  const pulse = formData.get("pulse_ms");
  const pulseValue = pulse && String(pulse).trim() !== "" ? pulse : undefined;

  return gateSchema.safeParse({
    code: formData.get("code") ?? "",
    name: formData.get("name") ?? "",
    location: formData.get("location") ?? "",
    direction_mode: formData.get("direction_mode") ?? "entry",
    enforcement_mode: formData.get("enforcement_mode") ?? "monitor",
    anti_passback: formData.get("anti_passback") ?? "soft",
    relay_mode: formData.get("relay_mode") ?? "none",
    relay_url: formData.get("relay_url") ?? "",
    open_command: formData.get("open_command") ?? "",
    close_command: formData.get("close_command") ?? "",
    pulse_ms: pulseValue,
  });
}

export async function createGate(formData: FormData): Promise<GateActionResult> {
  const staff = await getAccessStaff();
  if (!staff?.canManage) return { error: "You don't have permission to manage gates." };

  const parsed = readGateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the gate details." };
  }

  const credential = generateGateKey();
  const db = loose(createAdminClient());

  const { data, error } = await db
    .from("access_gates")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      location: parsed.data.location || null,
      direction_mode: parsed.data.direction_mode,
      enforcement_mode: parsed.data.enforcement_mode,
      anti_passback: parsed.data.anti_passback,
      relay_mode: parsed.data.relay_mode,
      relay_config: buildRelayConfig(parsed.data),
      device_key_hash: credential.hash,
      device_key_prefix: credential.prefix,
      key_rotated_at: new Date().toISOString(),
      created_by: staff.staffId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    const message = (error as { message?: string }).message ?? "";
    return {
      error: message.includes("duplicate key")
        ? "A gate with that code already exists."
        : "Could not create the gate. Please try again.",
    };
  }

  const gateId = (data as { id: string } | null)?.id;
  await logAuditEvent(staff.userId, "access_gate_created", "access_gates", {
    gate_id: gateId,
    code: parsed.data.code,
  });

  revalidatePath("/staff/gates");
  return { ok: true, gateId, deviceKey: credential.key };
}

export async function updateGate(
  gateId: string,
  formData: FormData,
): Promise<GateActionResult> {
  const staff = await getAccessStaff();
  if (!staff?.canManage) return { error: "You don't have permission to manage gates." };

  const parsed = readGateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the gate details." };
  }

  const db = loose(createAdminClient());
  const { error } = await db
    .from("access_gates")
    .update({
      code: parsed.data.code,
      name: parsed.data.name,
      location: parsed.data.location || null,
      direction_mode: parsed.data.direction_mode,
      enforcement_mode: parsed.data.enforcement_mode,
      anti_passback: parsed.data.anti_passback,
      relay_mode: parsed.data.relay_mode,
      relay_config: buildRelayConfig(parsed.data),
    })
    .eq("id", gateId);

  if (error) return { error: "Could not save the gate settings." };

  await logAuditEvent(staff.userId, "access_gate_updated", "access_gates", {
    gate_id: gateId,
    enforcement_mode: parsed.data.enforcement_mode,
  });

  revalidatePath("/staff/gates");
  return { ok: true };
}

export async function setGateActive(
  gateId: string,
  isActive: boolean,
): Promise<GateActionResult> {
  const staff = await getAccessStaff();
  if (!staff?.canManage) return { error: "You don't have permission to manage gates." };

  const db = loose(createAdminClient());
  const { error } = await db
    .from("access_gates")
    .update({ is_active: isActive })
    .eq("id", gateId);

  if (error) return { error: "Could not change the gate status." };

  await logAuditEvent(staff.userId, "access_gate_updated", "access_gates", {
    gate_id: gateId,
    is_active: isActive,
  });

  revalidatePath("/staff/gates");
  return { ok: true };
}

/**
 * Issues a fresh device key and invalidates the old one immediately. Use when
 * a kiosk is replaced, stolen, or a key may have been shared.
 */
export async function rotateGateKey(gateId: string): Promise<GateActionResult> {
  const staff = await getAccessStaff();
  if (!staff?.canManage) return { error: "You don't have permission to manage gates." };

  const credential = generateGateKey();
  const db = loose(createAdminClient());

  const { error } = await db
    .from("access_gates")
    .update({
      device_key_hash: credential.hash,
      device_key_prefix: credential.prefix,
      key_rotated_at: new Date().toISOString(),
    })
    .eq("id", gateId);

  if (error) return { error: "Could not rotate the key." };

  await logAuditEvent(staff.userId, "access_gate_key_rotated", "access_gates", {
    gate_id: gateId,
  });

  revalidatePath("/staff/gates");
  return { ok: true, deviceKey: credential.key };
}

const reviewSchema = z.object({
  status: z.enum(["reviewed", "dismissed", "confirmed"]),
  notes: z.string().trim().max(2000).optional(),
});

export async function reviewAnomaly(
  anomalyId: string,
  status: "reviewed" | "dismissed" | "confirmed",
  notes?: string,
): Promise<GateActionResult> {
  const staff = await getAccessStaff();
  if (!staff?.canManage) return { error: "You don't have permission to review anomalies." };

  const parsed = reviewSchema.safeParse({ status, notes });
  if (!parsed.success) return { error: "Invalid review." };

  const db = loose(createAdminClient());
  const { error } = await db
    .from("access_anomalies")
    .update({
      status: parsed.data.status,
      review_notes: parsed.data.notes || null,
      reviewed_by: staff.staffId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", anomalyId);

  if (error) return { error: "Could not save the review." };

  await logAuditEvent(staff.userId, "access_anomaly_reviewed", "access_anomalies", {
    anomaly_id: anomalyId,
    status: parsed.data.status,
  });

  revalidatePath("/staff/gates");
  return { ok: true };
}
