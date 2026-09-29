import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { finalPolicies, migrationsInOrder } from "@/lib/testing/migrations";

/**
 * Guards who can read the staff table.
 *
 * RLS filters rows, not columns. 00001 let every signed-in user read every
 * staff row — role_type and can_access_confidential included, which between
 * them say who is cleared for CODI cases — under a policy named "view staff
 * names". 00024 replaced it with staff_names(), which returns names only.
 *
 * These fail if a later migration opens the table up again, if staff_names()
 * grows a column, or if a student page goes back to reading the table — which
 * would now return no rows without an error, and label every staff reply
 * "User".
 */

const staff = finalPolicies("staff");

describe("the staff policies, as the migrations leave them", () => {
  // If the parser stopped working, the check below would pass for the
  // wrong reason — so first prove it sees both creations and drops.
  it("sees policies created and dropped by later migrations", () => {
    expect(staff.has("Staff can view own record")).toBe(true); // from 00001
    expect(staff.has("Staff can view all staff")).toBe(true); // added in 00024
    expect(staff.has("All authenticated can view staff names")).toBe(false); // dropped in 00024
  });

  it("lets only the staff member, other staff and admins read a staff row", () => {
    const allowed = new Set(["user_id = auth.uid()", "public.is_staff()", "public.user_role() = 'admin'"]);
    const broader = [...staff.values()]
      .filter((policy) => policy.command === "SELECT" || policy.command === "ALL")
      .filter((policy) => !allowed.has(policy.using))
      .map((policy) => `${policy.name}: ${policy.using}`);
    expect(broader, "a read policy wider than staff and admins").toEqual([]);
  });
});

describe("staff_names()", () => {
  const sql = migrationsInOrder().join("\n");

  it("returns a name and nothing else", () => {
    const definitions = [...sql.matchAll(/FUNCTION public\.staff_names\s*\([^)]*\)\s*RETURNS TABLE\s*\(([^)]*)\)/gi)];
    expect(definitions, "staff_names() definition not found").not.toHaveLength(0);

    const columns = definitions.at(-1)![1].split(",").map((part) => part.trim().split(/\s+/)[0].toLowerCase());
    expect(columns).toEqual(["user_id", "full_name"]);
  });

  it("is callable once signed in, and not before", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.staff_names\(UUID\[\]\) FROM [^;]*\banon\b/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.staff_names\(UUID\[\]\) TO authenticated\b/i);
  });
});

describe("student pages", () => {
  const root = join(process.cwd(), "src", "app", "(student)");
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => /\.tsx?$/.test(file));

  it("never read the staff table directly", () => {
    expect(files.length, "no student pages found").toBeGreaterThan(0);

    const readers = files.filter((file) => /from\(\s*["']staff["']\s*\)/.test(readFileSync(join(root, file), "utf8")));
    expect(readers, "use staff_names() instead").toEqual([]);
  });
});
