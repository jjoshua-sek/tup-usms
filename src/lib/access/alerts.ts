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
    /**
     * When the scan happened on the offline copy and reached the cloud only
     * later ("Oct 21, 10:47 AM"), so staff do not mistake it for a new scan.
     */
    offlineAt?: string;
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
  const verb = input.letThrough ? "used" : "refused";
  const title = `${input.status === "suspended" ? "Suspended" : "Revoked"} ID ${verb} at ${input.gateLabel}${input.offlineAt ? " (offline)" : ""}`;
  const when = input.offlineAt ? `While STARS was offline, on ${input.offlineAt}, ` : "";
  const body =
    input.status === "suspended"
      ? `${when}${who} ${input.letThrough ? "was let through" : "was refused for another reason"} with a suspended ID. Follow up with the student, then mark the alert reviewed on Gates & Access.`
      : `${when}${who}'s ID, reported lost or stolen, ${input.letThrough ? "was let through: the offline copy did not know yet" : "was refused"}. Whoever holds the card may not be its owner. Mark the alert reviewed on Gates & Access once handled.`;

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
