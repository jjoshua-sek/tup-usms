"use server";

import { revalidatePath } from "next/cache";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

interface Result {
  ok?: boolean;
  error?: string;
}

/**
 * Marking a notification read is a student-owned write: the RLS policy from
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

  revalidatePath("/notifications");
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

  revalidatePath("/notifications");
  return { ok: true };
}
