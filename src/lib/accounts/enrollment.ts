/**
 * Reading an enrollment list.
 *
 * Pure — text in, validated rows out — because this is the one place
 * untrusted data enters account creation, and every rule here decides
 * whether a real person gets a login. Tested in enrollment.test.ts.
 *
 * The list is CSV, which is what a registrar's system or a spreadsheet
 * exports. Headers are matched loosely ("Student No.", "student_number",
 * "Surname") because the file will come from whatever tool the registrar
 * happens to use, not from us.
 */

export const MAX_ROWS = 1000;

export const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"] as const;
export type YearLevel = (typeof YEAR_LEVELS)[number];

export const STUDENT_NUMBER = /^TUPM-\d{2}-\d{4}$/;

/** Login email for a student number — the same derivation the login form uses. */
export function loginEmailFor(studentNumber: string): string {
  return `${studentNumber.trim().toLowerCase()}@tup.edu.ph`;
}

export interface EnrollmentRecord {
  student_number: string;
  first_name: string;
  last_name: string;
  email: string;
  program: string;
  year_level: YearLevel;
  section: string | null;
}

export interface ParsedRow {
  /** 1-based line in the file, counting the header, so staff can find it. */
  line: number;
  record: EnrollmentRecord | null;
  errors: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Problems with the file as a whole; when present, rows is empty. */
  fileErrors: string[];
}

// ============================================================
// CSV
// ============================================================

/**
 * Splits CSV text into rows of fields. Handles quoted fields containing
 * commas and line breaks, doubled quotes inside quotes, CRLF line endings
 * and the byte-order mark Excel writes at the start of a UTF-8 file.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Blank lines — a trailing newline, or spacing someone added by hand.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

// ============================================================
// HEADERS
// ============================================================

type Column = keyof EnrollmentRecord;

const HEADER_ALIASES: Record<Column, string[]> = {
  student_number: ["student_number", "student number", "student no", "student_no", "studentno", "id number", "tupm number"],
  first_name: ["first_name", "first name", "firstname", "given name", "given_name"],
  last_name: ["last_name", "last name", "lastname", "surname", "family name"],
  email: ["email", "personal_email", "personal email", "email_address", "email address", "e-mail"],
  program: ["program", "course", "degree program"],
  year_level: ["year_level", "year level", "year", "yr level"],
  section: ["section", "block"],
};

const REQUIRED: Column[] = ["student_number", "first_name", "last_name", "email", "program", "year_level"];

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[.#]/g, "").replace(/\s+/g, " ");
}

function mapHeaders(headers: string[]): { index: Partial<Record<Column, number>>; missing: Column[] } {
  const normalized = headers.map(normalizeHeader);
  const index: Partial<Record<Column, number>> = {};

  for (const column of Object.keys(HEADER_ALIASES) as Column[]) {
    const position = normalized.findIndex((header) => HEADER_ALIASES[column].includes(header));
    if (position >= 0) index[column] = position;
  }

  return { index, missing: REQUIRED.filter((column) => index[column] === undefined) };
}

// ============================================================
// FIELDS
// ============================================================

/** Strips control characters and collapses whitespace. */
function clean(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Accepts "1", "1st", "1st yr", "First Year", "1st Year" and returns the canonical form. */
export function normalizeYearLevel(value: string): YearLevel | null {
  const text = value.trim().toLowerCase();
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const digit = text.match(/^([1-5])/)?.[1];
  const word = Object.keys(words).find((key) => text.startsWith(key));
  const year = digit ? Number(digit) : word ? words[word] : null;
  return year ? YEAR_LEVELS[year - 1] : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateRecord(cells: string[], index: Partial<Record<Column, number>>): {
  record: EnrollmentRecord | null;
  errors: string[];
} {
  const get = (column: Column) => clean(index[column] === undefined ? "" : cells[index[column]!]);
  const errors: string[] = [];

  const studentNumber = get("student_number").toUpperCase();
  if (!STUDENT_NUMBER.test(studentNumber)) {
    errors.push(`Student number "${studentNumber || "(blank)"}" is not in the TUPM-XX-XXXX format.`);
  }

  const firstName = get("first_name");
  const lastName = get("last_name");
  if (!firstName) errors.push("First name is blank.");
  if (!lastName) errors.push("Last name is blank.");
  if (firstName.length > 100 || lastName.length > 100) errors.push("A name is longer than 100 characters.");

  const email = get("email").toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    errors.push(`Email "${email || "(blank)"}" is not a valid address.`);
  }

  const program = get("program");
  if (!program) errors.push("Program is blank.");
  if (program.length > 120) errors.push("Program is longer than 120 characters.");

  const rawYear = get("year_level");
  const yearLevel = normalizeYearLevel(rawYear);
  if (!yearLevel) errors.push(`Year level "${rawYear || "(blank)"}" is not 1st to 5th Year.`);

  const section = get("section");
  if (section.length > 20) errors.push("Section is longer than 20 characters.");

  if (errors.length > 0) return { record: null, errors };

  return {
    record: {
      student_number: studentNumber,
      first_name: firstName,
      last_name: lastName,
      email,
      program,
      year_level: yearLevel!,
      section: section || null,
    },
    errors,
  };
}

// ============================================================
// ENTRY POINT
// ============================================================

export function parseEnrollmentList(text: string): ParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], fileErrors: ["The file is empty."] };

  const { index, missing } = mapHeaders(table[0]);
  if (missing.length > 0) {
    return {
      rows: [],
      fileErrors: [
        `The first row must name the columns. Missing: ${missing.join(", ")}. ` +
          "Download the template to see the expected headers.",
      ],
    };
  }

  const body = table.slice(1);
  if (body.length === 0) return { rows: [], fileErrors: ["The file has headers but no students."] };
  if (body.length > MAX_ROWS) {
    return {
      rows: [],
      fileErrors: [`The file has ${body.length} students; import at most ${MAX_ROWS} at a time.`],
    };
  }

  const seen = new Map<string, number>();
  const rows: ParsedRow[] = body.map((cells, offset) => {
    const line = offset + 2;
    const { record, errors } = validateRecord(cells, index);

    if (record) {
      const firstLine = seen.get(record.student_number);
      if (firstLine !== undefined) {
        return {
          line,
          record: null,
          errors: [`${record.student_number} already appears on line ${firstLine}.`],
        };
      }
      seen.set(record.student_number, line);
    }

    return { line, record, errors };
  });

  return { rows, fileErrors: [] };
}

/**
 * Re-validates one record the browser sent back for import. The preview
 * ran on the server too, but the import action cannot assume the browser
 * returned what it was given.
 */
export function revalidateRecord(input: Partial<Record<Column, unknown>>): EnrollmentRecord | null {
  const columns = Object.keys(HEADER_ALIASES) as Column[];
  const cells = columns.map((column) => (typeof input[column] === "string" ? (input[column] as string) : ""));
  const index = Object.fromEntries(columns.map((column, position) => [column, position])) as Record<Column, number>;
  return validateRecord(cells, index).record;
}
