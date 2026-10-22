import "server-only";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in staff member may act on a case.
 *
 * Case actions run on the service-role client, which ignores row-level
 * security, after checking only that the caller is OSA staff. A restricted
 * case (migration 00040: visible to the OSA head, the administrator and its
 * officer) must not be workable by every officer who learns its id, so the
 * question is put to the database as the caller: if their own session cannot
 * read the case, they cannot act on it either. One rule, the RLS policy,
 * decides both.
 */
export async function staffCanSeeCase(caseId: string): Promise<boolean> {
  const db = loose(await createClient());
  const { data } = await db.from("violation_cases").select("id").eq("id", caseId).maybeSingle();
  return Boolean(data);
}

export const CASE_NOT_VISIBLE = "This case is restricted to its assigned officer and the OSA head.";
