import { describe, expect, it } from "vitest";

import { buildCollegeReport, normalizeCollege, reportCsv, resolveColleges, totalRow, UNKNOWN_COLLEGE } from "./college-report";

const students = [
  { id: "a", program: "BSIT", college: "COS" }, // from a verified COR
  { id: "b", program: "bsit", college: null }, // no COR yet: counted by program
  { id: "c", program: "BSCE", college: "coe" },
  { id: "d", program: "BSHM", college: null }, // no one in this program has a college yet
];

const input = {
  students,
  cases: [
    { student_id: "a", classification: "minor", open: true, thisTerm: true },
    { student_id: "b", classification: "major", open: false, thisTerm: false },
    { student_id: "c", classification: "minor", open: false, thisTerm: true },
  ],
  concernsThisTerm: [{ student_id: "b" }, { student_id: "d" }],
  idsValidatedThisTerm: [{ student_id: "a" }, { student_id: "c" }],
  clearancesIssued: [{ student_id: "c" }],
  highRisk: [{ student_id: "b" }],
};

describe("resolveColleges", () => {
  it("uses a student's own college, else their program's usual one, else Not set", () => {
    const colleges = resolveColleges(students);
    expect(colleges.get("a")).toEqual({ college: "COS", inferred: false });
    expect(colleges.get("b")).toEqual({ college: "COS", inferred: true });
    expect(colleges.get("c")).toEqual({ college: "COE", inferred: false });
    expect(colleges.get("d")).toEqual({ college: UNKNOWN_COLLEGE, inferred: false });
  });
});

describe("buildCollegeReport", () => {
  it("counts per college, with Not set last", () => {
    const rows = buildCollegeReport(input);
    expect(rows.map((row) => row.college)).toEqual(["COE", "COS", UNKNOWN_COLLEGE]);
    const cos = rows.find((row) => row.college === "COS")!;
    expect(cos).toMatchObject({ students: 2, estimated: 1, casesThisTerm: 1, openCases: 1, minorCases: 1, majorCases: 1, concernsThisTerm: 1, idsValidated: 1, highRisk: 1 });
    expect(totalRow(rows)).toMatchObject({ students: 4, concernsThisTerm: 2, clearancesIssued: 1 });
  });

  it("breaks one college down by program", () => {
    const rows = buildCollegeReport(input, "COS");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ program: "BSIT", students: 2 });
  });
});

describe("reportCsv", () => {
  it("writes a header, the rows and a total, with no names", () => {
    const csv = reportCsv(buildCollegeReport(input), { byProgram: false, termLabel: "1st Semester, AY 2026–2027" });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("College,Students,College estimated from program,Cases filed this term,Open cases,Minor cases,Major cases,Concerns this term,IDs validated this term,Clearances issued,High or critical risk");
    expect(lines[2]).toBe("COE,1,0,1,0,1,0,0,1,1,0");
    expect(lines.at(-1)).toMatch(/^Total,4,/);
    expect(lines[0]).toMatch(/^# TUP-Manila STARS/);
  });
});

describe("normalizeCollege", () => {
  it("accepts a short code only", () => {
    expect(normalizeCollege(" cos ")).toBe("COS");
    expect(normalizeCollege("College of Science and Technology Studies")).toBeNull();
    expect(normalizeCollege(null)).toBeNull();
  });
});
