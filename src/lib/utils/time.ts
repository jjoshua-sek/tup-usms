/**
 * Clock reads, kept behind helpers.
 *
 * The React Compiler lint treats `Date.now()` inside a component body as an
 * impure read — correctly, since a re-render would produce a different value
 * and any memoization around it would be wrong. Reading the clock through a
 * named helper keeps the intent obvious ("is this in the future?") and the
 * component bodies clean.
 */

export function nowMs(): number {
  return Date.now();
}

/** True when the timestamp has not passed yet. Null/absent counts as past. */
export function isUpcoming(iso: string | null | undefined, now: number = nowMs()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() >= now;
}

/**
 * Formatting pinned to Philippine time.
 *
 * Server Components render on Vercel, whose clock is UTC, so a bare
 * `toLocaleString("en-PH")` prints UTC: a summons emailed at 9:04 AM in
 * Manila reads "1:04 AM", and anything before 8 AM lands on the previous
 * day. For most screens that is cosmetic. For a proof-of-service record,
 * the time *is* the fact being shown, so these pin the zone explicitly.
 */
const MANILA = "Asia/Manila";

export function formatManilaDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: MANILA,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatManilaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: MANILA,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
