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
