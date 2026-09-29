import { describe, expect, it } from "vitest";

import { migrationsInOrder } from "@/lib/testing/migrations";

/**
 * Guards who can call the work-queue functions.
 *
 * claim_* and reap_* functions are SECURITY DEFINER: they run past RLS,
 * return what they claim — email addresses, student numbers, concern text —
 * and mark it taken, so whoever calls them first gets the batch and the
 * real dispatcher never sees it.
 *
 * Supabase's default privileges grant EXECUTE on every new public function
 * to anon, authenticated and service_role directly, not through PUBLIC. A
 * migration that only says "REVOKE ... FROM PUBLIC" leaves anon's own grant
 * in place, and the function is callable with the public anon key. 00019,
 * 00021, 00022 and 00023 all did that; 00025 corrects them.
 *
 * This replays every CREATE FUNCTION, GRANT and REVOKE in migration order,
 * starting each definition from those defaults, and fails if a claim_ or
 * reap_ function ends up callable by anyone but service_role.
 */

const sql = migrationsInOrder().join("\n");

/** Supabase's grants on a function created in public: PUBLIC plus each API role. */
const DEFAULT_GRANTEES = ["public", "anon", "authenticated", "service_role"];

const TYPE_ALIASES: Record<string, string> = { INTEGER: "INT", INT4: "INT", BOOL: "BOOLEAN" };

/**
 * "p_limit INT DEFAULT 10, p_force BOOLEAN" (named) or "INT, BOOLEAN" (not)
 * → "INT,BOOLEAN", so a definition and its GRANTs resolve to the same key.
 */
function signature(args: string, named: boolean): string {
  return args
    .split(",")
    .map((part) => part.replace(/\s+DEFAULT\s[\s\S]*$/i, "").trim().split(/\s+/))
    .filter((words) => words[0])
    .map((words) => (named ? words.slice(1) : words).join(" ").toUpperCase())
    .map((type) => TYPE_ALIASES[type] ?? type)
    .join(",");
}

interface FunctionGrants {
  definer: boolean;
  grantees: Set<string>;
}

/**
 * Who holds EXECUTE on each public function once every migration has run.
 *
 * Every CREATE starts over from the defaults, even CREATE OR REPLACE of a
 * function that already exists — where Postgres would keep the old grants.
 * That is stricter than Postgres on purpose: 00022's DROP + CREATE silently
 * reset claim_invitation_batch's grants, so a definition is never trusted to
 * inherit them from an earlier file. Restate them after it, as every
 * migration here does.
 */
function finalFunctionGrants(): Map<string, FunctionGrants> {
  const events: Array<{ at: number; apply: (functions: Map<string, FunctionGrants>) => void }> = [];

  for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi)) {
    const key = `${match[1].toLowerCase()}(${signature(match[2], true)})`;
    // SECURITY DEFINER may come before the $$ body or after it.
    const rest = sql.slice(match.index! + match[0].length);
    const open = rest.search(/\bAS\s+\$\$/i);
    const close = rest.indexOf("$$", rest.indexOf("$$", open) + 2);
    const options = rest.slice(0, open) + rest.slice(close, rest.indexOf(";", close));
    events.push({
      at: match.index!,
      apply: (functions) =>
        functions.set(key, { definer: /SECURITY\s+DEFINER/i.test(options), grantees: new Set(DEFAULT_GRANTEES) }),
    });
  }

  for (const match of sql.matchAll(/\b(GRANT|REVOKE)\s+[\w\s]+?\s+ON\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s+(?:TO|FROM)\s+([^;]+);/gi)) {
    const [, verb, name, args, roles] = match;
    const key = `${name.toLowerCase()}(${signature(args, false)})`;
    // "anon, authenticated WITH GRANT OPTION" → ["anon", "authenticated"]
    const grantees = roles.split(",").map((role) => role.trim().split(/\s+/)[0].toLowerCase());
    events.push({
      at: match.index!,
      apply: (functions) => {
        const grants = functions.get(key)?.grantees;
        for (const role of grantees) {
          if (verb.toUpperCase() === "GRANT") grants?.add(role);
          else grants?.delete(role);
        }
      },
    });
  }

  const functions = new Map<string, FunctionGrants>();
  events.sort((a, b) => a.at - b.at).forEach((event) => event.apply(functions));
  return functions;
}

const functions = finalFunctionGrants();
const queue = [...functions].filter(([key, grants]) => grants.definer && /^(claim|reap)_/.test(key));

/** "claim_email_batch(INT,INT): anon, service_role" for each function that grants `role`. */
function callableBy(...roles: string[]): string[] {
  return queue
    .filter(([, grants]) => roles.some((role) => grants.grantees.has(role)))
    .map(([key, grants]) => `${key}: ${[...grants.grantees].sort().join(", ")}`);
}

describe("function grants, as the migrations leave them", () => {
  // If the parser stopped working, the checks below would pass for the
  // wrong reason — so first prove it sees definitions, grants and revokes.
  it("starts a function from Supabase's defaults and applies GRANT and REVOKE", () => {
    // 00024: REVOKE FROM PUBLIC, anon; GRANT TO authenticated. service_role
    // keeps the grant it got by default.
    expect([...(functions.get("staff_names(UUID[])")?.grantees ?? [])].sort()).toEqual([
      "authenticated",
      "service_role",
    ]);
  });

  it("finds every queue function", () => {
    expect(queue.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        "claim_email_batch(INT,INT)",
        "reap_stuck_email_sends(INT)",
        "claim_invitation_batch(INT)",
        "claim_concern_summaries(INT,UUID,BOOLEAN)",
      ]),
    );
  });
});

describe("claim_ and reap_ functions", () => {
  it("cannot be called with the anon key", () => {
    expect(callableBy("anon", "public"), "REVOKE ALL ... FROM PUBLIC, anon, authenticated").toEqual([]);
  });

  it("cannot be called by a signed-in user", () => {
    expect(callableBy("authenticated"), "REVOKE ALL ... FROM PUBLIC, anon, authenticated").toEqual([]);
  });

  it("can still be called by the dispatchers, which use the service-role client", () => {
    const missing = queue.filter(([, grants]) => !grants.grantees.has("service_role")).map(([key]) => key);
    expect(missing, "GRANT EXECUTE ... TO service_role").toEqual([]);
  });
});
