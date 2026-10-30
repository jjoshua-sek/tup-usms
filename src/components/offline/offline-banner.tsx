import { WifiSlashIcon as WifiOff } from "@phosphor-icons/react/ssr";
import { connection } from "next/server";

import { isOfflineMode, offlineBannerState } from "@/lib/offline/mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { cn } from "@/lib/utils";

/**
 * The strip across the top of every page on the LAN copy. It says the copy
 * is read-only and how old it is, and turns red when the five-minute
 * refresh has not succeeded for an hour: a suspension issued since then
 * may be missing, so staff confirm with the OSA head.
 *
 * Renders nothing online. The refresh time lives in offline_sync_state,
 * a table that exists only on the LAN database (lan/sql/lan-only.sql).
 */
export async function OfflineBanner() {
  if (!isOfflineMode()) return null;
  // Read at request time, never baked into a prerendered page.
  await connection();

  let lastRefresh: Date | null = null;
  let waiting = 0;
  try {
    const db = loose(createAdminClient());
    const [{ data }, { count }] = await Promise.all([
      db.from("offline_sync_state").select("last_success_at").eq("id", 1).maybeSingle(),
      // Gate scans and counter validations made here, not yet in the cloud.
      db.from("offline_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    const value = (data as { last_success_at: string | null } | null)?.last_success_at;
    lastRefresh = value ? new Date(value) : null;
    waiting = count ?? 0;
  } catch {
    // No state table yet: shown as "not yet copied", which is the truth.
  }

  const { asOf, stale } = offlineBannerState(lastRefresh, new Date());

  return (
    <div
      role="status"
      className={cn(
        "sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-2 text-center text-base font-medium text-white",
        stale ? "bg-red-700" : "bg-amber-600",
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        Offline mode · {asOf}. Look-ups, gate scans and counter validation only: record anything else on the paper
        downtime form.
      </span>
      {waiting > 0 && (
        <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold">
          {waiting} waiting to upload
        </span>
      )}
      {stale && <span className="font-semibold">Records may be out of date. Confirm suspensions with the OSA head.</span>}
    </div>
  );
}
