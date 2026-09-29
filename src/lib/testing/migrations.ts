import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test helper: what the schema looks like after every migration has run,
 * worked out from the SQL files rather than from memory.
 *
 * Exists because the code and the schema have disagreed silently three
 * times: notification types (00019), notification entity types (00020), and
 * a column 00006 dropped that four queries still selected. In each case the
 * code was written from an older definition than the one in force. Tests
 * that ask this module instead of the author cannot make that mistake.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8").replace(/--[^\n]*/g, ""));
}

/** Splits a CREATE TABLE body on commas that are not inside parentheses. */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** The parenthesised body that starts at `open`, matched by depth. */
function bodyFrom(sql: string, open: number): string {
  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, index);
    }
  }
  return "";
}

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude)\b/i;

/**
 * Columns `table` has once every migration has run in order. Understands
 * CREATE TABLE, ADD COLUMN, DROP COLUMN and RENAME COLUMN — everything the
 * migrations in this repository use to change a table's shape.
 */
export function finalColumns(table: string): Set<string> {
  const name = table.replace(/^public\./, "");
  const reference = `(?:public\\.)?${name}(?![\\w])`;
  const columns = new Set<string>();

  for (const sql of migrationsInOrder()) {
    // Events are applied in the order they appear within each file.
    const events: Array<{ at: number; apply: () => void }> = [];

    for (const match of sql.matchAll(new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+${reference}\\s*\\(`, "gi"))) {
      const open = match.index! + match[0].length - 1;
      const body = bodyFrom(sql, open);
      events.push({
        at: match.index!,
        apply: () => {
          for (const part of topLevelParts(body)) {
            const text = part.trim();
            if (!text || NOT_A_COLUMN.test(text)) continue;
            columns.add(text.split(/\s+/)[0].replace(/"/g, "").toLowerCase());
          }
        },
      });
    }

    for (const match of sql.matchAll(new RegExp(`ALTER TABLE(?:\\s+IF EXISTS)?(?:\\s+ONLY)?\\s+${reference}([^;]*);`, "gi"))) {
      const statement = match[1];
      events.push({
        at: match.index!,
        apply: () => {
          for (const add of statement.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/gi)) {
            columns.add(add[1].toLowerCase());
          }
          for (const drop of statement.matchAll(/DROP COLUMN(?:\s+IF EXISTS)?\s+"?(\w+)"?/gi)) {
            columns.delete(drop[1].toLowerCase());
          }
          for (const rename of statement.matchAll(/RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
            columns.delete(rename[1].toLowerCase());
            columns.add(rename[2].toLowerCase());
          }
        },
      });
    }

    events.sort((a, b) => a.at - b.at).forEach((event) => event.apply());
  }

  return columns;
}

export interface Policy {
  name: string;
  /** SELECT, INSERT, UPDATE, DELETE, or ALL when FOR is omitted. */
  command: string;
  /** The USING expression with whitespace collapsed; "" when there is none. */
  using: string;
}

/**
 * RLS policies on `table` once every migration has run in order. CREATE
 * POLICY adds or replaces one by name and DROP POLICY removes it, which is
 * how every migration here changes a policy.
 */
export function finalPolicies(table: string): Map<string, Policy> {
  const name = table.replace(/^public\./, "");
  const reference = `(?:public\\.)?${name}(?![\\w])`;
  const policies = new Map<string, Policy>();

  for (const sql of migrationsInOrder()) {
    const events: Array<{ at: number; apply: () => void }> = [];

    for (const match of sql.matchAll(new RegExp(`CREATE POLICY\\s+"([^"]+)"\\s+ON\\s+${reference}([^;]*);`, "gi"))) {
      const [, policyName, clauses] = match;
      // FOR comes before USING / WITH CHECK; only look for it there.
      const head = clauses.split(/\b(?:USING|WITH\s+CHECK)\b/i)[0];
      const using = clauses.match(/\bUSING\s*\(/i);
      events.push({
        at: match.index!,
        apply: () => {
          policies.set(policyName, {
            name: policyName,
            command: (head.match(/\bFOR\s+(\w+)/i)?.[1] ?? "ALL").toUpperCase(),
            using: using
              ? bodyFrom(clauses, using.index! + using[0].length - 1).replace(/\s+/g, " ").trim()
              : "",
          });
        },
      });
    }

    for (const match of sql.matchAll(new RegExp(`DROP POLICY(?:\\s+IF EXISTS)?\\s+"([^"]+)"\\s+ON\\s+${reference}`, "gi"))) {
      events.push({ at: match.index!, apply: () => policies.delete(match[1]) });
    }

    events.sort((a, b) => a.at - b.at).forEach((event) => event.apply());
  }

  return policies;
}

/** Column names in a PostgREST select string, ignoring embedded resources. */
export function selectedColumns(select: string): string[] {
  return topLevelParts(select)
    .map((part) => part.trim())
    .filter(Boolean)
    // "violation_types(name)" and "students!inner(id)" are embedded
    // resources — other tables — not columns of this one.
    .filter((part) => !part.includes("("))
    .map((part) => part.toLowerCase());
}
