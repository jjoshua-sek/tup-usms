import { describe, expect, it } from "vitest";

import { strictSchemaProblems } from "@/lib/ai/groq-core";

import { STAMPED_SCAN_JSON_SCHEMA, compareWithScan, parseStampedScan, type StampedScan } from "./stamped-scan";

// What the student uploaded (read from the ERS PDF).
const uploaded = {
  student_number: "TUPM-23-5047",
  school_year: "2025-2026",
  semester: "2nd Semester",
  gwa: 1.5,
  subjects: [
    { subject_code: "CC303-M", units: 3, grade: 2.25 },
    { subject_code: "IT303--M", units: 3, grade: 1.25 },
    { subject_code: "IT343_M", units: 3, grade: 1.25 },
  ],
};

// The stamped paper, as the vision model read the photo.
const paper: StampedScan = {
  document_kind: "rating_slip",
  student_number: "TUPM-23-5047",
  school_year: "2025-2026",
  semester: "Second",
  gwa: 1.5,
  subjects: [
    { subject_code: "CC303-M", units: 3, grade: "2.25" },
    { subject_code: "IT303-M", units: 3, grade: "1.25" },
    { subject_code: "IT343-M", units: 3, grade: "1.25" },
  ],
  registrar_stamp: true,
  osa_stamp: false,
  overall_confidence: 0.9,
  notes: null,
};

const compare = (scan: Partial<StampedScan>, upload = uploaded) =>
  compareWithScan({ documentType: "rating_slip", uploaded: upload, scan: { ...paper, ...scan } });

describe("compareWithScan", () => {
  it("verifies when every row matches and the Registrar stamped it", () => {
    const result = compare({});
    expect(result.verdict).toBe("match");
    expect(result.canVerify).toBe(true);
    expect(result.rowsMatched).toBe(3);
  });

  it("catches a grade that differs from the stamped paper", () => {
    const result = compare({ subjects: paper.subjects.map((row) => (row.subject_code === "CC303-M" ? { ...row, grade: "2.75" } : row)) });
    expect(result.verdict).toBe("differences");
    expect(result.canVerify).toBe(false);
    expect(result.differences).toContain("CC303-M grade: 2.75 on paper, 2.25 uploaded.");
  });

  it("catches a subject added to or missing from the upload", () => {
    const result = compare({}, { ...uploaded, subjects: [...uploaded.subjects, { subject_code: "IT999", units: 3, grade: 1 }] });
    expect(result.differences).toContain("IT999 is in the upload but not on the paper.");
  });

  it("will not verify without the Registrar's stamp, even when every row matches", () => {
    const result = compare({ registrar_stamp: false });
    expect(result.verdict).toBe("match");
    expect(result.canVerify).toBe(false);
    expect(result.summary).toMatch(/no Registrar stamp/);
  });

  it("asks for a retake when the photo is unclear", () => {
    const result = compare({ overall_confidence: 0.3 });
    expect(result.verdict).toBe("unclear");
    expect(result.canVerify).toBe(false);
  });

  it("notices the wrong paper and the wrong term", () => {
    expect(compare({ document_kind: "certificate_of_registration" }).differences[0]).toMatch(/is a COR/);
    expect(compare({ semester: "First" }).differences).toContain("Semester: First on paper, 2nd Semester uploaded.");
  });

  it("blames a misread upload, not the student, when only the paper adds up", () => {
    // The real COR: the AI took "IT Capstone & Research 1" as 1 unit.
    const result = compareWithScan({
      documentType: "certificate_of_registration",
      uploaded: { units_enrolled: 6, subjects: [{ subject_code: "IT413-M", units: 1 }, { subject_code: "IT453-M", units: 3 }] },
      scan: { ...paper, document_kind: "certificate_of_registration", gwa: null, subjects: [{ subject_code: "IT413-M", units: 3, grade: null }, { subject_code: "IT453-M", units: 3, grade: null }] },
    });
    expect(result.canVerify).toBe(false);
    expect(result.likelyMisread).toBe(true);
    expect(result.summary).toMatch(/probably misread/);
  });

  it("still asks the student when the upload's own figures add up but differ from the paper", () => {
    const result = compare({ subjects: paper.subjects.map((row) => (row.subject_code === "CC303-M" ? { ...row, grade: "2.75" } : row)) });
    expect(result.likelyMisread).toBe(false);
    expect(result.summary).toMatch(/ask the student/);
  });

  it("compares units only on a COR", () => {
    const cor = compareWithScan({
      documentType: "certificate_of_registration",
      uploaded: { subjects: [{ subject_code: "IT413-M", units: 3 }] },
      scan: { ...paper, document_kind: "certificate_of_registration", gwa: null, subjects: [{ subject_code: "IT413-M", units: 3, grade: null }] },
    });
    expect(cor.canVerify).toBe(true);
  });
});

describe("the stamped-scan schema and parser", () => {
  it("meets Groq's strict-schema rules", () => {
    expect(strictSchemaProblems(STAMPED_SCAN_JSON_SCHEMA)).toEqual([]);
  });

  it("reads a reply, and a confidence given as a percentage", () => {
    const parsed = parseStampedScan(JSON.stringify({ ...paper, overall_confidence: 85 }));
    expect(parsed.ok && parsed.data.overall_confidence).toBe(0.85);
    expect(parseStampedScan("not json").ok).toBe(false);
  });
});
