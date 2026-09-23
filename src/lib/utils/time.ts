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
 *
 * Client components need the same pinning when they render a stored
 * timestamp on first paint: they are prerendered on the server too, and a
 * UTC server render that disagrees with a Manila browser is a hydration
 * mismatch.
 *
 * Postgres `date` columns arrive as "2026-09-24", which `new Date` reads as
 * UTC midnight — 8 AM the same day in Manila — so they format as the
 * calendar date they hold.
 */
const MANILA = "Asia/Manila";
const LOCALE = "en-PH";

type DateInput = string | Date | null | undefined;

/**
 * Any Intl shape, in Manila time. The named helpers below cover the shapes
 * the portal repeats; reach for this one for a shape used once.
 */
export function formatManila(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(LOCALE, { ...options, timeZone: MANILA });
}

/** "Sep 25, 2026" */
export function formatManilaDate(value: DateInput): string {
  return formatManila(value, { month: "short", day: "numeric", year: "numeric" });
}

/** "September 25, 2026" */
export function formatManilaLongDate(value: DateInput): string {
  return formatManila(value, { month: "long", day: "numeric", year: "numeric" });
}

/** "Sep 25" */
export function formatManilaMonthDay(value: DateInput): string {
  return formatManila(value, { month: "short", day: "numeric" });
}

/** "Sep 25, 2026, 9:00 AM" */
export function formatManilaDateTime(value: DateInput): string {
  return formatManila(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Sep 25, 9:00 AM" */
export function formatManilaMonthDayTime(value: DateInput): string {
  return formatManila(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "9:00 AM" */
export function formatManilaTime(value: DateInput): string {
  return formatManila(value, { hour: "numeric", minute: "2-digit" });
}

/**
 * Wall-clock arithmetic in Manila time.
 *
 * Philippine Standard Time is UTC+8 all year — the Philippines does not
 * observe daylight saving — so moving between an instant and Manila
 * wall-clock time is a fixed shift. That is what lets the hearing scheduler
 * reason about "8 AM on a Tuesday" on a server whose own zone is UTC.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface ManilaWallClock {
  year: number;
  /** 0-based, as in `Date`. */
  month: number;
  day: number;
  /** 0 = Sunday, as in `Date#getDay`. */
  weekday: number;
  /** Minutes past Manila midnight. */
  minutes: number;
}

export function manilaWallClock(date: Date): ManilaWallClock {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * The instant at a Manila wall-clock time. Out-of-range days and minutes
 * roll over the way `Date.UTC` rolls them, so `day + 3` is three days later.
 */
export function manilaInstant(year: number, month: number, day: number, minutes = 0): Date {
  return new Date(Date.UTC(year, month, day, 0, minutes) - MANILA_OFFSET_MS);
}

/**
 * Manila midnight at the start of the day `now` falls on — the start of any
 * "today" window. `setHours(0, 0, 0, 0)` finds the server's midnight instead,
 * which on Vercel is 8 AM in Manila: before then, "today" would take in most
 * of yesterday, and after it, miss the small hours.
 */
export function startOfManilaDay(now: Date = new Date()): Date {
  const { year, month, day } = manilaWallClock(now);
  return manilaInstant(year, month, day);
}

const WALL_CLOCK_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Reads an `<input type="datetime-local">` value ("2026-09-25T09:00") as
 * Manila time. `new Date(value)` reads it in the server's zone instead —
 * UTC on Vercel — which books a 9:00 AM hearing for 5:00 PM.
 *
 * Returns null for anything that is not a real calendar time: Feb 30 is
 * refused rather than rolled over to March.
 */
export function parseManilaDateTime(value: string): Date | null {
  const match = value.trim().match(WALL_CLOCK_INPUT);
  if (!match) return null;

  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;

  const instant = manilaInstant(year, month - 1, day, hour * 60 + minute);
  const check = manilaWallClock(instant);
  if (check.year !== year || check.month !== month - 1 || check.day !== day) return null;

  return instant;
}
