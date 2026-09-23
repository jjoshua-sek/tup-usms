/**
 * Turns directory search text into PostgREST filters.
 *
 * The text goes into an `.or()` filter string, where a comma separates
 * conditions and parentheses group them. A search containing
 * `x,student_number.neq.0` would otherwise stop being a search and become
 * a second, attacker-written filter. Anything that is not a letter, digit,
 * space or hyphen is removed before it reaches the query: names need
 * letters (including ñ and accented vowels), student numbers need digits
 * and hyphens, and nothing legitimate needs more.
 */

const MAX_TOKENS = 4;
const MAX_TOKEN_LENGTH = 40;

/** Columns a directory search matches against. */
const SEARCH_COLUMNS = ["first_name", "last_name", "student_number", "program"] as const;

export function searchTokens(query: string | null | undefined): string[] {
  return (query ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH))
    .filter((token) => token.replace(/-/g, "").length > 0)
    .slice(0, MAX_TOKENS);
}

/**
 * One `.or()` argument per token. Chained `.or()` calls are ANDed, so
 * "juan cruz" finds rows where each word matches some column. That is how
 * people type a full name, whichever order they use.
 */
export function tokenFilter(token: string): string {
  return SEARCH_COLUMNS.map((column) => `${column}.ilike.*${token}*`).join(",");
}

export const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"] as const;

export function parseYearLevel(value: string | null | undefined): (typeof YEAR_LEVELS)[number] | null {
  return (YEAR_LEVELS as readonly string[]).includes(value ?? "")
    ? (value as (typeof YEAR_LEVELS)[number])
    : null;
}

export function parsePage(value: string | null | undefined): number {
  const page = Number.parseInt(value ?? "", 10);
  return Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1;
}
