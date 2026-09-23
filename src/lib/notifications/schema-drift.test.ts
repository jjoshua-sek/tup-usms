import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NOTIFICATION_ENTITY_TYPES, NOTIFICATION_TYPES } from "./policy";

/**
 * Guards the seam that failed twice.
 *
 * `create_notification` inserts into a table with two CHECK constraints.
 * Every call site discards the RPC result, so a value outside either list
 * fails without a trace — which is how thirteen call sites (notification_type)
 * and then two more (related_entity_type) went undelivered for the life of
 * the feature.
 *
 * TypeScript now checks call sites against the unions in policy.ts. This
 * test checks the unions against the SQL: it finds the most recent CHECK
 * definition across the migrations, in order, and fails if the two lists
 * disagree in either direction.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

/**
 * Values allowed by the latest `CHECK (<column> IN (...))` for a column.
 *
 * Line comments are stripped first: 00012 annotates its list with comments
 * like "-- Scheduling (requirement #1)", whose parentheses would otherwise
 * end the match early. Anchoring on `CHECK (` skips RLS policies that use
 * the same `<column> IN (...)` shape for a narrower purpose.
 */
function latestCheckList(column: string): string[] {
  const pattern = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "gi");
  let latest: string | null = null;

  for (const sql of migrationsInOrder()) {
    const withoutComments = sql.replace(/--[^\n]*/g, "");
    for (const match of withoutComments.matchAll(pattern)) latest = match[1];
  }

  if (latest === null) throw new Error(`No CHECK constraint found for ${column}`);
  return [...latest.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value)).sort();
}

describe("notifications schema ↔ TypeScript", () => {
  it("allows exactly the notification types the code can send", () => {
    const sql = latestCheckList("notification_type");

    expect(difference(NOTIFICATION_TYPES, sql), "in TypeScript but rejected by SQL").toEqual([]);
    expect(difference(sql, NOTIFICATION_TYPES), "allowed by SQL but missing from TypeScript").toEqual([]);
  });

  it("allows exactly the entity types the code can link to", () => {
    const sql = latestCheckList("related_entity_type");

    expect(difference(NOTIFICATION_ENTITY_TYPES, sql), "in TypeScript but rejected by SQL").toEqual([]);
    expect(difference(sql, NOTIFICATION_ENTITY_TYPES), "allowed by SQL but missing from TypeScript").toEqual([]);
  });

  it("finds the constraint it is guarding", () => {
    // If the parser stops matching, the tests above would compare against a
    // stale definition and pass for the wrong reason.
    expect(latestCheckList("notification_type")).toContain("appeal_window_opened");
    expect(latestCheckList("related_entity_type")).toContain("case_settlement");
  });
});
