/**
 * Offline mode: STARS running on the OSA's LAN copy while campus internet is
 * down (the offline fallback plan, Phase 1).
 *
 * The cloud is the official record. The LAN copy is refreshed from it every
 * five minutes and is read-only: staff can sign in with their usual password
 * and look everything up, but nothing is saved, because the next refresh
 * would overwrite it. What must be recorded meanwhile goes on the paper
 * downtime form. (Phase 2 adds a few actions that are kept offline and
 * uploaded later.)
 *
 * Pure, so the rules can be tested; the proxy, the layouts and the banner
 * read them.
 */

type Env = Record<string, string | undefined>;

/** STARS_OFFLINE=true on the LAN install only; never set on Vercel. */
export function isOfflineMode(env: Env = process.env): boolean {
  return env.STARS_OFFLINE?.trim().toLowerCase() === "true";
}

/** Said, word for word, when a save is refused in offline mode. */
export const OFFLINE_REFUSAL =
  "STARS is in offline mode, so this wasn't saved. Changes resume once the internet is back; until then, record it on the paper downtime form.";

/**
 * Shown when a sign-in fails on the offline copy. Students cannot sign in
 * there at all (only staff passwords are copied), and a student with the
 * right password would otherwise be told it is wrong.
 */
export const OFFLINE_SIGN_IN_FAILED =
  "Wrong login ID or password. During an internet outage only OSA staff can sign in here; students, please use STARS online once the internet is back.";

/**
 * Pages whose saves the proxy lets through offline (Phase 2). The actions
 * there decide for themselves: on ID Validation only "Validate at the
 * counter" works offline; every other decision still refuses.
 */
export const OFFLINE_ACTION_PAGES = ["/staff/id-validation"] as const;

export function offlineAllowsActionOn(pathname: string): boolean {
  const page = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (OFFLINE_ACTION_PAGES as readonly string[]).includes(page);
}

/** API calls that only read, or keep a session alive, still work offline. */
export function offlineAllowsApi(method: string, pathname: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  return pathname === "/api/session/ping";
}

/** After this long without a successful refresh, the banner turns red. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

export interface OfflineBannerState {
  /** "records as of 10:42 AM" or "records as of Oct 20, 10:42 AM". */
  asOf: string;
  stale: boolean;
}

export function offlineBannerState(lastRefresh: Date | null, now: Date): OfflineBannerState {
  if (!lastRefresh || Number.isNaN(lastRefresh.getTime())) {
    return { asOf: "records not yet copied", stale: true };
  }
  const sameDay = manilaDate(lastRefresh) === manilaDate(now);
  const time = lastRefresh.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  return { asOf: `records as of ${time}`, stale: now.getTime() - lastRefresh.getTime() > STALE_AFTER_MS };
}

const manilaDate = (date: Date) => date.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
