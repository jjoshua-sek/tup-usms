"use server";

import { revalidatePath } from "next/cache";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

interface Result {
  ok?: boolean;
  error?: string;
}

/** Students and staff each have an inbox; both show the same kind of row. */
function revalidateInboxes() {
  revalidatePath("/notifications");
  revalidatePath("/staff/notifications");
}

/**
 * Marking a notification read is an owner-only write: the RLS policy from
 * 00012/00013 scopes `notifications` to `user_id = auth.uid()`, so these
 * actions need no ownership check of their own — an id belonging to someone
 * else simply updates zero rows.
 */
export async function markNotificationRead(notificationId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { error } = await loose(supabase)
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", user.id);

  if (error) return { error: "Could not update that notification." };

  revalidateInboxes();
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const { error } = await loose(supabase)
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (error) return { error: "Could not update your notifications." };

  revalidateInboxes();
  return { ok: true };
}
