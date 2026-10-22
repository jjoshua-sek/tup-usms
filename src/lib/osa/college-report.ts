/**
 * The OSA's figures per college (checklist I5: the OSA submits college
 * reports). Counts only, like the rest of Reports: no names, so a report
 * passed around a college office is not a copy of anyone's record. Pure,
 * so the grouping can be tested; the page and the CSV download share it.
 */

/** "cos", " COS " → "COS"; anything that is not a short code → null. */
export function normalizeCollege(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase().replace(/[^A-Z]/g, "") ?? "";
  return /^[A-Z]{2,8}$/.test(code) ? code : null;
}

/** "bsit", "BS IT" → "BSIT": a program as a grouping key. */
export function normalizeProgram(value: string | null | undefined): string {
  return value?.trim().toUpperCase().replace(/\s+/g, "") || "—";
}

export const UNKNOWN_COLLEGE = "Not set";

export interface StudentCollege {
  college: string;
  /** True when taken from other students of the same program, not the student's own COR. */
  inferred: boolean;
}

/**
 * Each student's college: their own, read from a verified COR, or else the
 * college most students of the same program have.
 */
export function resolveColleges(
  students: ReadonlyArray<{ id: string; program: string | null; college?: string | null }>,
): Map<string, StudentCollege> {
  const tally = new Map<string, Map<string, number>>();
  for (const student of students) {
    const college = normalizeCollege(student.college);
    if (!college) continue;
    const program = normalizeProgram(student.program);
    const counts = tally.get(program) ?? new Map<string, number>();
    counts.set(college, (counts.get(college) ?? 0) + 1);
    tally.set(program, counts);
  }
  const usual = new Map<string, string>();
  for (const [program, counts] of tally) {
    usual.set(program, [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }

  const resolved = new Map<string, StudentCollege>();
  for (const student of students) {
    const own = normalizeCollege(student.college);
    if (own) resolved.set(student.id, { college: own, inferred: false });
    else {
      const guess = usual.get(normalizeProgram(student.program));
      resolved.set(student.id, guess ? { college: guess, inferred: true } : { college: UNKNOWN_COLLEGE, inferred: false });
    }
  }
  return resolved;
}

export interface ReportInput {
  students: ReadonlyArray<{ id: string; program: string | null; college?: string | null }>;
  /** Cases filed this term, and whether each is still open. */
  cases: ReadonlyArray<{ student_id: string; classification: string; open: boolean; thisTerm: boolean }>;
  concernsThisTerm: ReadonlyArray<{ student_id: string }>;
  idsValidatedThisTerm: ReadonlyArray<{ student_id: string }>;
  clearancesIssued: ReadonlyArray<{ student_id: string }>;
  /** Students the risk model puts at high or critical. */
  highRisk: ReadonlyArray<{ student_id: string }>;
}

export interface ReportRow {
  college: string;
  /** Present on the per-program rows of one college's report. */
  program?: string;
  students: number;
  /** Of those, how many have no verified COR and were counted by program. */
  estimated: number;
  casesThisTerm: number;
  openCases: number;
  minorCases: number;
  majorCases: number;
  concernsThisTerm: number;
  idsValidated: number;
  clearancesIssued: number;
  highRisk: number;
}

const emptyRow = (college: string, program?: string): ReportRow => ({
  college,
  ...(program ? { program } : {}),
  students: 0,
  estimated: 0,
  casesThisTerm: 0,
  openCases: 0,
  minorCases: 0,
  majorCases: 0,
  concernsThisTerm: 0,
  idsValidated: 0,
  clearancesIssued: 0,
  highRisk: 0,
});

/**
 * One row per college; or, with `college` set, one row per program in that
 * college. Rows are sorted by name with "Not set" last.
 */
export function buildCollegeReport(input: ReportInput, college?: string): ReportRow[] {
  const colleges = resolveColleges(input.students);
  const programOf = new Map(input.students.map((student) => [student.id, normalizeProgram(student.program)]));
  const rows = new Map<string, ReportRow>();

  const rowFor = (studentId: string): ReportRow | null => {
    const where = colleges.get(studentId);
    if (!where) return null;
    if (college && where.college !== college) return null;
    const key = college ? programOf.get(studentId) ?? "—" : where.college;
    const row = rows.get(key) ?? emptyRow(where.college, college ? key : undefined);
    rows.set(key, row);
    return row;
  };

  for (const student of input.students) {
    const row = rowFor(student.id);
    if (!row) continue;
    row.students += 1;
    if (colleges.get(student.id)?.inferred) row.estimated += 1;
  }
  for (const item of input.cases) {
    const row = rowFor(item.student_id);
    if (!row) continue;
    if (item.thisTerm) row.casesThisTerm += 1;
    if (item.open) row.openCases += 1;
    if (item.classification === "minor") row.minorCases += 1;
    if (item.classification === "major") row.majorCases += 1;
  }
  const add = (items: ReadonlyArray<{ student_id: string }>, field: "concernsThisTerm" | "idsValidated" | "clearancesIssued" | "highRisk") => {
    for (const item of items) {
      const row = rowFor(item.student_id);
      if (row) row[field] += 1;
    }
  };
  add(input.concernsThisTerm, "concernsThisTerm");
  add(input.idsValidatedThisTerm, "idsValidated");
  add(input.clearancesIssued, "clearancesIssued");
  add(input.highRisk, "highRisk");

  const label = (row: ReportRow) => row.program ?? row.college;
  return [...rows.values()].sort((a, b) =>
    label(a) === UNKNOWN_COLLEGE ? 1 : label(b) === UNKNOWN_COLLEGE ? -1 : label(a).localeCompare(label(b)),
  );
}

/** The sum of the rows, for a report's total line. */
export function totalRow(rows: ReadonlyArray<ReportRow>, label = "Total"): ReportRow {
  const total = emptyRow(label);
  for (const row of rows) {
    for (const field of ["students", "estimated", "casesThisTerm", "openCases", "minorCases", "majorCases", "concernsThisTerm", "idsValidated", "clearancesIssued", "highRisk"] as const) {
      total[field] += row[field];
    }
  }
  return total;
}

const CSV_COLUMNS: Array<[keyof ReportRow, string]> = [
  ["students", "Students"],
  ["estimated", "College estimated from program"],
  ["casesThisTerm", "Cases filed this term"],
  ["openCases", "Open cases"],
  ["minorCases", "Minor cases"],
  ["majorCases", "Major cases"],
  ["concernsThisTerm", "Concerns this term"],
  ["idsValidated", "IDs validated this term"],
  ["clearancesIssued", "Clearances issued"],
  ["highRisk", "High or critical risk"],
];

/** A CSV a spreadsheet opens as-is: one header, the rows, then the total. */
export function reportCsv(rows: ReadonlyArray<ReportRow>, options: { byProgram: boolean; termLabel: string }): string {
  const quote = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = [options.byProgram ? "Program" : "College", ...CSV_COLUMNS.map(([, title]) => title)];
  const line = (name: string, row: ReportRow) => [name, ...CSV_COLUMNS.map(([key]) => row[key] as number)].map(quote).join(",");
  return [
    `# TUP-Manila STARS, ${options.termLabel}. Counts only.`,
    head.map(quote).join(","),
    ...rows.map((row) => line(options.byProgram ? row.program ?? "—" : row.college, row)),
    line("Total", totalRow(rows)),
  ].join("\r\n");
}
