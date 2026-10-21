import { describe, expect, it } from "vitest";

import { checkDocumentIntegrity, computeGwa, countPdfRevisions, isPdfBytes, normalizeGrade, normalizeSubjectCode, unitsFromGrades, type PdfFacts } from "./integrity";

// The real 2nd Sem 2025-2026 rating slip from ERS, as read.
const slip = {
  student_number: "TUPM-23-5047",
  student_name: "LLANILLO, JOSHUA MIGUEL DEL ROSARIO",
  gwa: 1.5,
  units_enrolled: 21,
  subjects: [
    { subject_code: "CC303-M", units: 3, grade: 2.25 },
    { subject_code: "GEE11D-M", units: 3, grade: 2 },
    { subject_code: "IT303--M", units: 3, grade: 1.25 },
    { subject_code: "IT323", units: 3, grade: 1.5 },
    { subject_code: "IT343_M", units: 3, grade: 1.25 },
    { subject_code: "IT363-M", units: 3, grade: 1.25 },
    { subject_code: "ITE4-M", units: 3, grade: 1 },
  ],
};
const student = { student_number: "TUPM-23-5047", first_name: "Joshua Miguel", last_name: "Llanillo" };
const fromErs: PdfFacts = { creator: null, producer: "Skia/PDF m141", revisions: 1 };

const statusOf = (checks: ReturnType<typeof checkDocumentIntegrity>, code: string) => checks.find((check) => check.code === code)?.status;

describe("checkDocumentIntegrity", () => {
  it("passes a genuine slip saved from ERS with the browser", () => {
    const checks = checkDocumentIntegrity({ documentType: "rating_slip", data: slip, student, pdf: fromErs });
    expect(checks.filter((check) => check.status === "warn")).toEqual([]);
    expect(statusOf(checks, "gwa")).toBe("pass");
  });

  it("catches one grade changed without the GWA", () => {
    const edited = { ...slip, subjects: slip.subjects.map((s) => (s.subject_code === "CC303-M" ? { ...s, grade: 1.25 } : s)) };
    const checks = checkDocumentIntegrity({ documentType: "rating_slip", data: edited, student, pdf: fromErs });
    expect(statusOf(checks, "gwa")).toBe("warn");
  });

  it("flags someone else's slip", () => {
    const checks = checkDocumentIntegrity({ documentType: "rating_slip", data: { ...slip, student_number: "TUPM-23-1111", student_name: "CRUZ, ANA" }, student, pdf: fromErs });
    expect(statusOf(checks, "student_number")).toBe("warn");
    expect(statusOf(checks, "student_name")).toBe("warn");
  });

  it("flags a grade off the TUP scale", () => {
    const odd = { ...slip, subjects: [...slip.subjects, { subject_code: "PE4", units: 2, grade: "1.10" }] };
    expect(statusOf(checkDocumentIntegrity({ documentType: "rating_slip", data: odd, student, pdf: null }), "grade_scale")).toBe("warn");
  });

  it("trusts ERS's own writer and a browser, but not an editor or a re-saved file", () => {
    const pdf = (facts: Partial<PdfFacts>) =>
      statusOf(checkDocumentIntegrity({ documentType: "certificate_of_registration", data: {}, student, pdf: { ...fromErs, ...facts } }), "pdf_source");
    expect(pdf({ creator: "R and OS php pdf writer, http://www.ros.co.nz", producer: null })).toBe("pass");
    expect(pdf({ producer: "Microsoft® Word for Microsoft 365" })).toBe("warn");
    expect(pdf({ creator: "Canva", producer: "Canva" })).toBe("warn");
    expect(pdf({ creator: null, producer: null })).toBe("warn");
    const resaved = checkDocumentIntegrity({ documentType: "certificate_of_registration", data: {}, student, pdf: { ...fromErs, revisions: 2 } });
    expect(statusOf(resaved, "pdf_revisions")).toBe("warn");
  });

  it("checks no GWA or grades on a COR, and nothing about the file on a photo", () => {
    const checks = checkDocumentIntegrity({ documentType: "certificate_of_registration", data: { units_enrolled: 18, subjects: [] }, student, pdf: null });
    expect(checks.map((check) => check.code)).toEqual(["student_number", "student_name", "units"]);
  });
});

describe("helpers", () => {
  it("treats ERS's inconsistent subject codes as one", () => {
    expect(normalizeSubjectCode("IT303--M")).toBe("IT303");
    expect(normalizeSubjectCode("IT343_M")).toBe("IT343");
    expect(normalizeSubjectCode("it323")).toBe("IT323");
    expect(normalizeSubjectCode("GEE11D-M")).toBe("GEE11D");
  });

  it("reads grades as printed", () => {
    expect(normalizeGrade(1.5)).toBe("1.50");
    expect(normalizeGrade("2")).toBe("2.00");
    expect(normalizeGrade(" inc ")).toBe("INC");
    expect(normalizeGrade(null)).toBeNull();
  });

  it("averages by units, leaving out NSTP and word ratings", () => {
    expect(computeGwa(slip.subjects)).toBeCloseTo(1.5, 5);
    expect(computeGwa([{ subject_code: "NSTP2", units: 3, grade: 1 }, { subject_code: "IT1", units: 3, grade: 2 }, { subject_code: "IT2", units: 3, grade: "INC" }])).toBe(2);
  });

  it("counts units passed and failed from the grades", () => {
    expect(unitsFromGrades(slip.subjects)).toEqual({ passed: 21, failed: 0 });
    expect(unitsFromGrades([{ units: 3, grade: 5 }, { units: 3, grade: 4 }, { units: 2, grade: "INC" }, { units: 3, grade: 3 }])).toEqual({ passed: 3, failed: 3 });
    expect(unitsFromGrades([{ subject_code: "IT1", units: 3 }])).toEqual({});
  });

  it("knows a PDF by its first bytes and counts its saves", () => {
    const pdf = new TextEncoder().encode("%PDF-1.3\n...\n%%EOF\n");
    expect(isPdfBytes(pdf)).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("<?php echo"))).toBe(false);
    expect(countPdfRevisions(pdf)).toBe(1);
    expect(countPdfRevisions(new TextEncoder().encode("%PDF-1.3\n%%EOF\nupdate\n%%EOF\n"))).toBe(2);
  });
});
