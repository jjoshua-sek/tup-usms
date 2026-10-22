import "server-only";

import type { NotificationType } from "@/lib/notifications/policy";
import type { LooseClient } from "@/lib/supabase/loose";

/**
 * Sends one notice to every OSA officer and the OSA head, for something a
 * student did that the office has to act on (an appeal filed, for one).
 * Server-only, with the service-role client: the staff list never reaches
 * the student whose action triggered it.
 */
export async function notifyOsaStaff(
  db: LooseClient,
  notice: {
    type: NotificationType;
    title: string;
    body: string;
    actionUrl: string;
    actionLabel: string;
    entityType: "violation_case";
    entityId: string;
  },
): Promise<void> {
  const { data, error } = await db
    .from("staff")
    .select("user_id")
    .in("role_type", ["osa_head", "osa_officer"])
    .not("user_id", "is", null);
  if (error) {
    console.error("[notify-osa] could not list OSA staff", error);
    return;
  }
  for (const row of (data as Array<{ user_id: string }> | null) ?? []) {
    await db.rpc("create_notification", {
      p_user_id: row.user_id,
      p_type: notice.type,
      p_title: notice.title,
      p_body: notice.body,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: notice.actionUrl,
      p_action_label: notice.actionLabel,
      p_entity_type: notice.entityType,
      p_entity_id: notice.entityId,
    });
  }
}
