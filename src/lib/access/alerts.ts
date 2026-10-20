import "server-only";

import type { LooseClient } from "@/lib/supabase/loose";
import { OSA_ROLES } from "@/lib/osa/staff-context";

type Db = LooseClient;

/**
 * Tells every OSA officer that a suspended or revoked ID was used at a gate.
 *
 * The gate lets a suspended student through (decide.ts) on the understanding
 * that the office hears about it at once and steps in itself. One alert per
 * anomaly: record_access_anomaly folds repeat scans by the same student
 * within 24 hours into the open anomaly, so only its first occurrence
 * notifies; the rest show as a count on Gates & Access.
 *
 * In-app only. The OSA works from the portal, and a stream of gate emails
 * would teach staff to ignore STARS mail.
 */
export async function alertOsaOfGateAnomaly(
  db: Db,
  input: {
    anomalyId: string;
    status: "suspended" | "revoked";
    studentName: string | null;
    studentNumber: string | null;
    gateLabel: string;
    /** False when a later check (an expired validation, another gate) refused it. */
    letThrough: boolean;
  },
): Promise<void> {
  const { data: anomaly } = await db
    .from("access_anomalies")
    .select("occurrence_count")
    .eq("id", input.anomalyId)
    .maybeSingle();
  if ((anomaly as { occurrence_count: number } | null)?.occurrence_count !== 1) return;

  const { data: staffRows, error } = await db
    .from("staff")
    .select("user_id")
    .in("role_type", OSA_ROLES)
    .not("user_id", "is", null);
  if (error) {
    console.error("[gate alert] could not list OSA staff", error);
    return;
  }

  const who = [input.studentName, input.studentNumber && `(${input.studentNumber})`].filter(Boolean).join(" ") || "A student";
  const title =
    input.status === "suspended"
      ? `Suspended ID ${input.letThrough ? "used" : "refused"} at ${input.gateLabel}`
      : `Revoked ID refused at ${input.gateLabel}`;
  const body =
    input.status === "suspended"
      ? `${who} ${input.letThrough ? "was let through" : "was refused for another reason"} with a suspended ID. Follow up with the student, then mark the alert reviewed on Gates & Access.`
      : `${who}'s ID is reported lost or stolen and was refused. Whoever holds the card may not be its owner. Mark the alert reviewed on Gates & Access once handled.`;

  for (const row of (staffRows as Array<{ user_id: string }> | null) ?? []) {
    const { error: notifyError } = await db.rpc("create_notification", {
      p_user_id: row.user_id,
      p_type: "gate_alert",
      p_title: title,
      p_body: body,
      p_priority: "high",
      p_channels: ["in_app"],
      p_action_url: "/staff/gates",
      p_action_label: "Review on Gates & Access",
      p_entity_type: "access_anomaly",
      p_entity_id: input.anomalyId,
    });
    if (notifyError) {
      // Before migration 00031 the type is refused. The anomaly itself is
      // already filed and visible on Gates & Access, so this is logged once.
      console.error("[gate alert] notification not created (run migration 00031?)", notifyError);
      return;
    }
  }
}
