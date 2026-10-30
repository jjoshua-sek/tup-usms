/**
 * The order the concern queue is read in: most urgent first, then newest.
 *
 * urgency_level is a TEXT column, so ordering it in the database sorts the
 * words alphabetically (medium, low, high, critical when descending), which
 * puts critical concerns last. The queue is sorted here instead.
 */

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Not yet assessed sorts after low: it has no urgency to act on yet. */
const UNASSESSED = 4;

export function byUrgencyThenNewest<T extends { urgency_level: string | null; created_at: string }>(
  a: T,
  b: T,
): number {
  const rank = (row: T) => URGENCY_RANK[row.urgency_level ?? ""] ?? UNASSESSED;
  return rank(a) - rank(b) || Date.parse(b.created_at) - Date.parse(a.created_at);
}
