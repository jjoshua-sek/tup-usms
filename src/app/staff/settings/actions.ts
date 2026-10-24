"use server";

import { revalidatePath } from "next/cache";

import { getStaffContext } from "@/lib/osa/staff-context";
import { RETENTION_KEYS, readRetention, retentionSchema } from "@/lib/settings/retention";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Records the retention periods the Data Protection Officer set (OSA
 * checklist I4), with the DPO's memo or reference. Administrators only;
 * the policy on system_settings enforces the same in the database.
 */
export async function saveRetention(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isAdmin) return { error: "Only the administrator records retention changes, on the DPO's instruction." };

  const parsed = retentionSchema.safeParse({
    recordYears: formData.get("recordYears"),
    accessLogDays: formData.get("accessLogDays"),
    dpoReference: formData.get("dpoReference") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the values." };

  const db = loose(await createClient());
  const { data: before } = await db.from("system_settings").select("key, value");
  const previous = readRetention(before as Array<{ key: string; value: unknown }> | null);

  const now = new Date().toISOString();
  const rows = [
    [RETENTION_KEYS.recordYears, parsed.data.recordYears],
    [RETENTION_KEYS.accessLogDays, parsed.data.accessLogDays],
    [RETENTION_KEYS.dpoReference, sanitizeText(parsed.data.dpoReference, 120)],
  ] as const;
  for (const [key, value] of rows) {
    const { data, error } = await db
      .from("system_settings")
      .update({ value, updated_by: staff.staffId, updated_at: now })
      .eq("key", key)
      .select("key");
    if (error || ((data as unknown[] | null) ?? []).length === 0) {
      return {
        error: ["PGRST205", "42P01"].includes((error as { code?: string } | null)?.code ?? "")
          ? "Retention settings need migration 00047. Ask the administrator to run it."
          : "The retention settings could not be saved.",
      };
    }
  }

  await logAuditEvent(staff.userId, "retention_changed", "system_settings", {
    from: previous,
    to: parsed.data,
  });

  revalidatePath("/staff/settings");
  revalidatePath("/id");
  return { ok: true, message: "Retention updated. Students see the new periods from their next page load." };
}
