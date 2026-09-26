import { describe, expect, it } from "vitest";

import { finalColumns, selectedColumns } from "@/lib/testing/migrations";

import { CONCERN_STUDENT_COLUMNS, DIRECTORY_COLUMNS, RECORD_PROFILE_COLUMNS } from "./columns";

const students = finalColumns("students");

describe("the students schema, as the migrations leave it", () => {
  // If the parser stopped working, every check below would pass for the
  // wrong reason — so first prove it sees both additions and removals.
  it("sees columns added and dropped by later migrations", () => {
    expect(students.has("profile_completed_at")).toBe(true); // added in 00004
    expect(students.has("section")).toBe(false); // dropped in 00006
    expect(students.has("student_number")).toBe(true); // from 00001
  });
});

describe("every column the app selects from students still exists", () => {
  it.each([
    ["student record", RECORD_PROFILE_COLUMNS],
    ["student directory", DIRECTORY_COLUMNS],
    ["concern detail", CONCERN_STUDENT_COLUMNS],
  ])("%s", (_name, select) => {
    const missing = selectedColumns(select).filter((column) => !students.has(column));
    expect(missing, "selected but not in the schema").toEqual([]);
  });
});

describe("selectedColumns", () => {
  it("reads plain columns and skips embedded resources", () => {
    expect(selectedColumns("id, case_number, violation_types(name), students!inner(id)")).toEqual([
      "id",
      "case_number",
    ]);
  });
});
