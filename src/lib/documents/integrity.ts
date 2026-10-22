import type { ExtractedAcademicData } from "@/types/osa";

/**
 * Checks run on every uploaded COR and rating slip, before an officer sees
 * it. Pure, so they can be tested; run-extraction.ts runs them and stores
 * the result, and the Document Review page shows it.
 *
 * Why: a rating slip from ERS is issued by the student to themselves ("ISSUED
 * BY: <the student>", "NOT VALID FOR TRANSFER"), and a PDF can be edited. These
 * checks cannot prove a document genuine; that is the stamped copy scanned at
 * the counter (stamped-scan.ts). They catch the cheap fakes and tell the
 * officer what to look at. A failed check is a flag, never a rejection: a
 * misread figure fails one just as an edit does.
 */

export type CheckStatus = "pass" | "warn" | "skip";

export interface IntegrityCheck {
  code: "student_number" | "student_name" | "term" | "gwa" | "units" | "grade_scale" | "pdf_source" | "pdf_revisions";
  status: CheckStatus;
  detail: string;
}

export interface PdfFacts {
  /** The PDF's Creator and Producer, as written into the file. */
  creator: string | null;
  producer: string | null;
  /** How many times the file was saved: more than one means it was changed after it was made. */
  revisions: number;
}

/** Grades a TUP rating slip prints as numbers. */
const NUMERIC_GRADES = new Set(["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"]);
/** Ratings printed as words, which count toward no average. */
const WORD_GRADES = /^(INC|DRP|DROPPED|W|WP|WF|NG|P|PASSED|F|FAILED|S|U|IP|NC|CR)$/i;

/** How ERS makes a PDF directly, or how a browser saves one with Print → Save as PDF. */
const TRUSTED_PDF_MAKERS = /R and OS php pdf writer|ros\.co\.nz|Skia\/PDF|Chrom(e|ium)|Microsoft Edge|Quartz PDFContext|Safari|Mozilla|Firefox|pdf\.js|Microsoft: Print To PDF/i;
/** Programs a PDF passes through when someone edits it. */
const EDITING_TOOLS = /Microsoft.{0,10}(Word|Excel|PowerPoint)|Canva|iLovePDF|Acrobat|PDFescape|Smallpdf|Sejda|LibreOffice|OpenOffice|WPS|Foxit|Nitro|PDFelement|PDF-XChange|Google Docs|PDFfiller|DocFly|Photoshop|GIMP/i;

/** "IT303--M", "IT343_M" and "it303-m" are one subject; ERS's own codes are inconsistent. */
export function normalizeSubjectCode(code: string | undefined | null): string {
  return (code ?? "")
    .toUpperCase()
    .replace(/[\s_-]+M$/, "")
    .replace(/[^A-Z0-9]/g, "");
}

/** "1.5" → "1.50", "INC" → "INC", 1.25 → "1.25"; anything unreadable → null. */
export function normalizeGrade(grade: number | string | undefined | null): string | null {
  if (grade === undefined || grade === null) return null;
  const text = String(grade).trim().toUpperCase();
  if (text === "") return null;
  return /^\d(\.\d{1,2})?$/.test(text) ? Number(text).toFixed(2) : text;
}

/** NSTP and word ratings are left out of the GWA, as ERS itself says. */
function countsTowardGwa(subject: { subject_code?: string; units?: number; grade?: number | string }): boolean {
  const grade = normalizeGrade(subject.grade);
  return Boolean(
    grade && NUMERIC_GRADES.has(grade) && subject.units && subject.units > 0 && !/^NSTP/i.test(normalizeSubjectCode(subject.subject_code)),
  );
}

/** The units-weighted average of the numeric grades, or null when there are none. */
export function computeGwa(subjects: ExtractedAcademicData["subjects"]): number | null {
  const counted = (subjects ?? []).filter(countsTowardGwa);
  const units = counted.reduce((total, subject) => total + (subject.units ?? 0), 0);
  if (units === 0) return null;
  const weighted = counted.reduce((total, subject) => total + Number(normalizeGrade(subject.grade)) * (subject.units ?? 0), 0);
  return weighted / units;
}

export function checkDocumentIntegrity(input: {
  documentType: "certificate_of_registration" | "rating_slip" | "transcript";
  data: ExtractedAcademicData;
  student: { student_number: string; first_name: string; last_name: string };
  pdf: PdfFacts | null;
}): IntegrityCheck[] {
  const { data, student } = input;
  const checks: IntegrityCheck[] = [];
  const isSlip = input.documentType === "rating_slip";

  // Whose document it is.
  const printedNumber = data.student_number?.trim().toUpperCase() ?? "";
  checks.push(
    !printedNumber
      ? { code: "student_number", status: "skip", detail: "No student number could be read." }
      : printedNumber === student.student_number.toUpperCase()
        ? { code: "student_number", status: "pass", detail: `Student number ${printedNumber} matches the account.` }
        : { code: "student_number", status: "warn", detail: `The document says ${printedNumber}, but the account is ${student.student_number}.` },
  );

  const printedName = (data.student_name ?? "").toUpperCase();
  checks.push(
    !printedName
      ? { code: "student_name", status: "skip", detail: "No name could be read." }
      : printedName.includes(student.last_name.trim().toUpperCase())
        ? { code: "student_name", status: "pass", detail: "The surname matches the account." }
        : { code: "student_name", status: "warn", detail: `The name on it (${data.student_name}) does not include the account's surname, ${student.last_name}.` },
  );

  // Its own arithmetic: an edited grade rarely comes with a recomputed average.
  if (isSlip) {
    const computed = computeGwa(data.subjects);
    checks.push(
      data.gwa == null || computed == null
        ? { code: "gwa", status: "skip", detail: "No printed GWA, or no numeric grades, to check against." }
        : Math.abs(computed - data.gwa) <= 0.005
          ? { code: "gwa", status: "pass", detail: `The grades average to the printed GWA, ${data.gwa.toFixed(3)}.` }
          : {
              code: "gwa",
              status: "warn",
              detail: `The grades and units average to ${computed.toFixed(3)}, but the printed GWA is ${data.gwa.toFixed(3)}. A grade may have been changed or misread.`,
            },
    );

    const offScale = (data.subjects ?? [])
      .map((subject) => ({ code: subject.subject_code ?? "?", grade: normalizeGrade(subject.grade) }))
      .filter((entry) => entry.grade !== null && !NUMERIC_GRADES.has(entry.grade) && !WORD_GRADES.test(entry.grade));
    checks.push(
      offScale.length === 0
        ? { code: "grade_scale", status: "pass", detail: "Every grade is on the TUP grading scale." }
        : {
            code: "grade_scale",
            status: "warn",
            detail: `Not on the TUP scale: ${offScale.map((entry) => `${entry.code} ${entry.grade}`).join(", ")}.`,
          },
    );
  }

  const units = (data.subjects ?? []).map((subject) => subject.units);
  const unitTotal = data.units_enrolled;
  checks.push(
    unitTotal == null || units.length === 0 || units.some((value) => value == null)
      ? { code: "units", status: "skip", detail: "No printed unit total to check against." }
      : Math.abs((units as number[]).reduce((sum, value) => sum + value, 0) - unitTotal) < 0.01
        ? { code: "units", status: "pass", detail: `The subjects' units add up to the printed ${unitTotal}.` }
        : {
            code: "units",
            status: "warn",
            detail: `The subjects' units add up to ${(units as number[]).reduce((sum, value) => sum + value, 0)}, not the printed ${unitTotal}.`,
          },
  );

  // Where the file came from. Photos have no such trail.
  if (input.pdf) {
    const maker = [input.pdf.creator, input.pdf.producer].filter(Boolean).join(" / ");
    checks.push(
      !maker
        ? { code: "pdf_source", status: "warn", detail: "The PDF does not say what made it. Files from ERS or a browser always do." }
        : EDITING_TOOLS.test(maker)
          ? { code: "pdf_source", status: "warn", detail: `Last saved by ${maker}, an editing program, not ERS or a browser.` }
          : TRUSTED_PDF_MAKERS.test(maker)
            ? { code: "pdf_source", status: "pass", detail: `Made by ${maker}: ERS or a browser's Save as PDF.` }
            : { code: "pdf_source", status: "warn", detail: `Made by ${maker}, which is not how ERS or a browser saves a PDF.` },
    );
    checks.push(
      input.pdf.revisions <= 1
        ? { code: "pdf_revisions", status: "pass", detail: "Saved once, as made." }
        : { code: "pdf_revisions", status: "warn", detail: `Saved ${input.pdf.revisions} times: it was changed after it was made.` },
    );
  }

  return checks;
}

/**
 * Units passed and failed from the grades, for a rating slip that prints no
 * such totals (ERS's does not): 3.00 or better passes, 5.00 fails. A 4.00
 * (conditional) or a word rating counts as neither until it is resolved.
 */
export function unitsFromGrades(subjects: ExtractedAcademicData["subjects"]): { passed?: number; failed?: number } {
  let passed = 0;
  let failed = 0;
  let any = false;
  for (const subject of subjects ?? []) {
    const grade = normalizeGrade(subject.grade);
    if (!grade || !subject.units || !NUMERIC_GRADES.has(grade)) continue;
    any = true;
    if (Number(grade) <= 3) passed += subject.units;
    else if (grade === "5.00") failed += subject.units;
  }
  return any ? { passed, failed } : {};
}

/**
 * The term printed on a document, as STARS stores terms: "2025-2026" and
 * "1st Semester" / "2nd Semester" / "Summer". ERS prints "Second", the
 * COR "First"; anything unclear gives null.
 */
export function printedTerm(schoolYear: string | null | undefined, semester: string | null | undefined): { schoolYear: string; semester: string } | null {
  const year = schoolYear?.trim().match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (!year || Number(year[2]) !== Number(year[1]) + 1) return null;
  const text = semester?.trim().toLowerCase() ?? "";
  const term = /sum/.test(text) ? "Summer" : /^(1st|first)\b/.test(text) ? "1st Semester" : /^(2nd|second)\b/.test(text) ? "2nd Semester" : null;
  return term ? { schoolYear: `${year[1]}-${year[2]}`, semester: term } : null;
}

/** True when the file's first bytes say PDF, whatever its name (ERS saves rating slips as .php). */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

/** How many times a PDF was saved: each save appends its own end-of-file marker. */
export function countPdfRevisions(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  return Math.max(1, text.match(/%%EOF/g)?.length ?? 0);
}

/** The checks an officer should look at, for the review list. */
export function flaggedChecks(checks: IntegrityCheck[] | null | undefined): IntegrityCheck[] {
  return (checks ?? []).filter((check) => check.status === "warn");
}
