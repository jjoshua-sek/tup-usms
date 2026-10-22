import { STUDENT_NUMBER, parseCsv } from "@/lib/accounts/enrollment";

/**
 * Reading an attendance sheet a college or the Registrar sends the OSA
 * (checklist E2). Pure, so it can be tested; the action is importAttendance
 * in app/staff/risk/attendance/actions.ts.
 *
 * One row per student. Either sessions and absences, or an attendance rate
 * (as a percent, 0–100, or a fraction, 0–1). Headers are matched loosely,
 * since every office names its columns its own way.
 */

export const MAX_ATTENDANCE_ROWS = 5000;

export interface AttendanceRow {
  /** 1-based line in the file, counting the header, so staff can find it. */
  line: number;
  student_number: string;
  sessions_held: number | null;
  sessions_absent: number | null;
  /** 0–1, rounded to three places. */
  attendance_rate: number;
}

export interface AttendanceParse {
  rows: AttendanceRow[];
  problems: Array<{ line: number; message: string }>;
  /** Set when the file itself cannot be read: no header we recognize. */
  error?: string;
}

const HEADERS = {
  student_number: /^(student\s*(no|number|#|id)|stud\s*no|id\s*(no|number)|tupm\s*(no|id)?)\.?$/i,
  sessions: /^(sessions?(\s*held)?|total\s*(sessions|classes|meetings|days)|classes\s*held|meetings|days\s*held|no\.?\s*of\s*(sessions|classes|meetings))$/i,
  absences: /^(absences?|absent|days\s*absent|no\.?\s*of\s*absences|times\s*absent)$/i,
  rate: /^(attendance(\s*(rate|%|percent(age)?))?|%\s*attendance|rate|percent(age)?)$/i,
};

const clean = (value: string | undefined) => (value ?? "").trim();
const toNumber = (value: string): number | null => {
  const text = value.replace(/%$/, "").trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
};

export function parseAttendanceCsv(text: string): AttendanceParse {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { rows: [], problems: [], error: "The file is empty." };

  const header = table[0].map((cell) => clean(cell).replace(/\s+/g, " "));
  const find = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));
  const col = { student: find(HEADERS.student_number), sessions: find(HEADERS.sessions), absences: find(HEADERS.absences), rate: find(HEADERS.rate) };

  if (col.student < 0) return { rows: [], problems: [], error: "No student number column. Name it \"Student No.\"." };
  if (col.rate < 0 && (col.sessions < 0 || col.absences < 0)) {
    return { rows: [], problems: [], error: "Give either \"Sessions\" and \"Absences\" columns, or an \"Attendance %\" column." };
  }
  if (table.length - 1 > MAX_ATTENDANCE_ROWS) {
    return { rows: [], problems: [], error: `At most ${MAX_ATTENDANCE_ROWS} students per file. Split it and import each part.` };
  }

  const rows: AttendanceRow[] = [];
  const problems: AttendanceParse["problems"] = [];
  const seen = new Map<string, number>();

  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const studentNumber = clean(cells[col.student]).toUpperCase();
    if (!STUDENT_NUMBER.test(studentNumber)) {
      problems.push({ line, message: `"${clean(cells[col.student])}" is not a student number (TUPM-YY-NNNN).` });
      return;
    }
    if (seen.has(studentNumber)) {
      problems.push({ line, message: `${studentNumber} is also on line ${seen.get(studentNumber)}; only the first is used.` });
      return;
    }

    let sessions: number | null = null;
    let absences: number | null = null;
    let rate: number | null = null;

    if (col.sessions >= 0 && col.absences >= 0) {
      sessions = toNumber(clean(cells[col.sessions]));
      absences = toNumber(clean(cells[col.absences]));
    }
    if (sessions !== null && absences !== null && !Number.isNaN(sessions) && !Number.isNaN(absences)) {
      if (!Number.isInteger(sessions) || sessions <= 0 || !Number.isInteger(absences) || absences < 0 || absences > sessions) {
        problems.push({ line, message: `${studentNumber}: sessions must be a whole number above 0, and absences between 0 and the sessions.` });
        return;
      }
      rate = (sessions - absences) / sessions;
    } else if (col.rate >= 0) {
      const given = toNumber(clean(cells[col.rate]));
      if (given === null || Number.isNaN(given) || given < 0 || given > 100) {
        problems.push({ line, message: `${studentNumber}: "${clean(cells[col.rate])}" is not an attendance rate (0–100%).` });
        return;
      }
      // 0.85 and 85 both mean 85%; a value above 1 is read as a percent.
      rate = given > 1 ? given / 100 : given;
      sessions = null;
      absences = null;
    } else {
      problems.push({ line, message: `${studentNumber}: sessions and absences are missing.` });
      return;
    }

    seen.set(studentNumber, line);
    rows.push({
      line,
      student_number: studentNumber,
      sessions_held: sessions,
      sessions_absent: absences,
      attendance_rate: Math.round(rate * 1000) / 1000,
    });
  });

  return { rows, problems };
}

/** 1st Sem 2026-2027 → 20261, as academic_snapshots orders terms. */
export function termSequence(schoolYear: string, semester: string): number {
  const startYear = Number(schoolYear.split("-")[0]);
  const offset = semester === "1st Semester" ? 1 : semester === "2nd Semester" ? 2 : 3;
  return startYear * 10 + offset;
}

/** A small file staff can fill in, with the columns spelled the way the reader expects. */
export const ATTENDANCE_TEMPLATE = "Student No.,Sessions,Absences\r\nTUPM-23-0001,54,3\r\nTUPM-23-0002,54,12\r\n";
