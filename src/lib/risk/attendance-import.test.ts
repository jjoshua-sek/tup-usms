import { describe, expect, it } from "vitest";

import { ATTENDANCE_TEMPLATE, parseAttendanceCsv, termSequence } from "./attendance-import";

describe("parseAttendanceCsv", () => {
  it("reads sessions and absences into a rate", () => {
    const result = parseAttendanceCsv(ATTENDANCE_TEMPLATE);
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([
      { line: 2, student_number: "TUPM-23-0001", sessions_held: 54, sessions_absent: 3, attendance_rate: 0.944 },
      { line: 3, student_number: "TUPM-23-0002", sessions_held: 54, sessions_absent: 12, attendance_rate: 0.778 },
    ]);
  });

  it("reads a percent or a fraction, and other offices' column names", () => {
    const result = parseAttendanceCsv("Stud No,Attendance %\ntupm-22-0148,85%\nTUPM-22-0149,0.9\n");
    expect(result.rows.map((row) => [row.student_number, row.attendance_rate])).toEqual([
      ["TUPM-22-0148", 0.85],
      ["TUPM-22-0149", 0.9],
    ]);
  });

  it("reports bad rows by line and keeps the good ones", () => {
    const result = parseAttendanceCsv(
      "Student Number,Total Classes,Days Absent\nTUPM-23-0001,40,2\n2023-0002,40,1\nTUPM-23-0003,40,41\nTUPM-23-0001,40,5\n",
    );
    expect(result.rows.map((row) => row.student_number)).toEqual(["TUPM-23-0001"]);
    expect(result.problems.map((problem) => problem.line)).toEqual([3, 4, 5]);
    expect(result.problems[2].message).toMatch(/also on line 2/);
  });

  it("refuses a file it cannot read at all", () => {
    expect(parseAttendanceCsv("").error).toMatch(/empty/);
    expect(parseAttendanceCsv("Name,Absences\nJuan,3\n").error).toMatch(/student number/);
    expect(parseAttendanceCsv("Student No.,Absences\nTUPM-23-0001,3\n").error).toMatch(/Sessions/);
  });
});

describe("termSequence", () => {
  it("orders terms", () => {
    expect(termSequence("2026-2027", "1st Semester")).toBe(20261);
    expect(termSequence("2025-2026", "Summer")).toBeLessThan(termSequence("2026-2027", "1st Semester"));
  });
});
