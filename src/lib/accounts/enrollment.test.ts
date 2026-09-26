import { describe, expect, it } from "vitest";

import {
  loginEmailFor,
  normalizeYearLevel,
  parseCsv,
  parseEnrollmentList,
  revalidateRecord,
} from "./enrollment";

const HEADER = "student_number,first_name,last_name,email,program,year_level,section";

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
    ]);
  });

  it("handles CRLF, a byte-order mark and blank lines", () => {
    expect(parseCsv("﻿x,y\r\n\r\n1,2\r\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });
});

describe("normalizeYearLevel", () => {
  it("accepts the ways people actually write a year", () => {
    for (const value of ["1", "1st", "1st yr", "1st Year", "first year", "FIRST"]) {
      expect(normalizeYearLevel(value), value).toBe("1st Year");
    }
    expect(normalizeYearLevel("4th Year")).toBe("4th Year");
  });

  it("rejects anything outside 1st to 5th", () => {
    expect(normalizeYearLevel("6th Year")).toBeNull();
    expect(normalizeYearLevel("senior")).toBeNull();
    expect(normalizeYearLevel("")).toBeNull();
  });
});

describe("parseEnrollmentList", () => {
  it("reads a clean list", () => {
    const result = parseEnrollmentList(
      `${HEADER}\nTUPM-99-0001,Juan,Dela Cruz,juan@example.com,BSIT,1st Year,A`,
    );

    expect(result.fileErrors).toEqual([]);
    expect(result.rows[0].record).toEqual({
      student_number: "TUPM-99-0001",
      first_name: "Juan",
      last_name: "Dela Cruz",
      email: "juan@example.com",
      program: "BSIT",
      year_level: "1st Year",
      section: "A",
    });
  });

  it("matches headers the way a registrar's export writes them", () => {
    const result = parseEnrollmentList(
      "Student No.,Given Name,Surname,E-mail,Course,Year\ntupm-99-0002,Ana,Reyes,ANA@Example.com,BSCE,2",
    );

    expect(result.fileErrors).toEqual([]);
    expect(result.rows[0].record).toMatchObject({
      student_number: "TUPM-99-0002",
      email: "ana@example.com",
      year_level: "2nd Year",
      section: null,
    });
  });

  it("names the missing columns instead of guessing", () => {
    const result = parseEnrollmentList("student_number,first_name\nTUPM-99-0001,Juan");

    expect(result.rows).toEqual([]);
    expect(result.fileErrors[0]).toMatch(/last_name/);
    expect(result.fileErrors[0]).toMatch(/email/);
  });

  it("reports every problem on a row, with the line to find it on", () => {
    const result = parseEnrollmentList(`${HEADER}\n2024-0001,,Cruz,not-an-email,BSIT,7th,A`);
    const [row] = result.rows;

    expect(row.line).toBe(2);
    expect(row.record).toBeNull();
    expect(row.errors).toHaveLength(4);
  });

  // Two accounts cannot share a login, and the first occurrence is the
  // one staff will expect to have been used.
  it("keeps the first of two rows with the same student number", () => {
    const result = parseEnrollmentList(
      `${HEADER}\nTUPM-99-0001,Juan,Cruz,a@example.com,BSIT,1,A\nTUPM-99-0001,Juana,Cruz,b@example.com,BSIT,1,A`,
    );

    expect(result.rows[0].record).not.toBeNull();
    expect(result.rows[1].record).toBeNull();
    expect(result.rows[1].errors[0]).toMatch(/line 2/);
  });

  it("strips control characters an export can smuggle into a name", () => {
    const result = parseEnrollmentList(`${HEADER}\nTUPM-99-0001,Ju\u0007an,Cruz,a@example.com,BSIT,1,`);

    expect(result.rows[0].record?.first_name).toBe("Ju an");
  });

  it("refuses an empty file and a header-only file", () => {
    expect(parseEnrollmentList("").fileErrors[0]).toMatch(/empty/);
    expect(parseEnrollmentList(HEADER).fileErrors[0]).toMatch(/no students/);
  });
});

describe("revalidateRecord", () => {
  it("accepts a record as the preview produced it", () => {
    expect(
      revalidateRecord({
        student_number: "TUPM-99-0001",
        first_name: "Juan",
        last_name: "Cruz",
        email: "juan@example.com",
        program: "BSIT",
        year_level: "1st Year",
        section: "A",
      }),
    ).not.toBeNull();
  });

  // The browser holds the previewed rows between preview and import, so
  // the import action must not trust them.
  it("rejects a record tampered with in the browser", () => {
    expect(
      revalidateRecord({
        student_number: "ADMIN",
        first_name: "Juan",
        last_name: "Cruz",
        email: "juan@example.com",
        program: "BSIT",
        year_level: "1st Year",
      }),
    ).toBeNull();
    expect(revalidateRecord({ student_number: 42 as unknown as string })).toBeNull();
  });
});

describe("loginEmailFor", () => {
  it("matches the login form's derivation", () => {
    expect(loginEmailFor("TUPM-99-0001")).toBe("tupm-99-0001@tup.edu.ph");
  });
});
