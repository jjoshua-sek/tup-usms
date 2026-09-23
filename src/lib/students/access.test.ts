import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { OSA_RECORD_ROLES, recordAccess } from "./access";
import { parsePage, parseYearLevel, searchTokens, tokenFilter } from "./search";

describe("recordAccess", () => {
  const as = (role: Parameters<typeof recordAccess>[0]["role"], extra = {}) =>
    recordAccess({ role, isOsa: false, isCounselor: false, ...extra });

  it("refuses roles with no business in a student record", () => {
    expect(as("security_guard")).toBeNull();
    expect(as("faculty")).toBeNull();
    expect(as("codi_member")).toBeNull();
  });

  it("limits the Registrar and Cashier to clearance and ID", () => {
    for (const role of ["registrar", "cashier"] as const) {
      expect(as(role)).toEqual({ osaRecord: false, risk: false, guidance: false });
    }
  });

  it("shows the risk score only where /staff/risk would", () => {
    // Committee members read cases through is_osa_staff() but are not
    // shown early-warning scores anywhere else.
    expect(as("sdb_member")?.risk).toBe(false);
    expect(as("osa_officer", { isOsa: true })?.risk).toBe(true);
    expect(as("guidance_counselor", { isCounselor: true })?.risk).toBe(true);
  });

  it("keeps guidance scheduling to guidance staff and the OSA head", () => {
    expect(as("osa_officer", { isOsa: true })?.guidance).toBe(false);
    expect(as("osa_head", { isOsa: true })?.guidance).toBe(true);
    expect(as("guidance_counselor", { isCounselor: true })?.guidance).toBe(true);
  });

  // The page's idea of "OSA staff" has to be the database's, or a section
  // renders empty for someone RLS would have let see it — or the reverse.
  it("matches the roles in public.is_osa_staff()", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "00013_osa_rls_policies.sql"),
      "utf8",
    );
    const body = sql.match(/FUNCTION public\.is_osa_staff\(\)[\s\S]*?role_type IN \(([^)]*)\)/);
    expect(body, "is_osa_staff() definition not found").not.toBeNull();

    const sqlRoles = [...body![1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
    expect([...OSA_RECORD_ROLES].sort()).toEqual(sqlRoles);
  });
});

describe("searchTokens", () => {
  it("splits a full name into words", () => {
    expect(searchTokens("  Juan   Dela Cruz ")).toEqual(["Juan", "Dela", "Cruz"]);
  });

  it("keeps student numbers intact", () => {
    expect(searchTokens("TUPM-24-0123")).toEqual(["TUPM-24-0123"]);
  });

  it("keeps Filipino and accented names", () => {
    expect(searchTokens("Peñaflor Añonuevo José")).toEqual(["Peñaflor", "Añonuevo", "José"]);
  });

  // The reason this module exists.
  it("cannot smuggle a second filter into the query", () => {
    const tokens = searchTokens("x,student_number.neq.0),(id.not.is.null");
    for (const token of tokens) {
      expect(token).not.toMatch(/[,().*]/);
    }
    expect(tokenFilter(tokens[0]).split(",")).toHaveLength(4);
  });

  it("strips PostgREST wildcards", () => {
    expect(searchTokens("*")).toEqual([]);
    expect(searchTokens("cruz*")).toEqual(["cruz"]);
  });

  it("ignores tokens that are only hyphens", () => {
    expect(searchTokens("- -- cruz")).toEqual(["cruz"]);
  });

  it("caps the number and length of tokens", () => {
    expect(searchTokens("a b c d e f")).toHaveLength(4);
    expect(searchTokens("x".repeat(100))[0]).toHaveLength(40);
  });
});

describe("directory parameters", () => {
  it("accepts only real year levels", () => {
    expect(parseYearLevel("3rd Year")).toBe("3rd Year");
    expect(parseYearLevel("9th Year")).toBeNull();
    expect(parseYearLevel(undefined)).toBeNull();
  });

  it("falls back to the first page on anything odd", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-2")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});
