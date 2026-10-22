import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkDocumentIntegrity, printedTerm, type IntegrityCheck } from "@/lib/documents/integrity";
import type { ExtractedAcademicData } from "@/types/osa";
import { readPdfFacts } from "@/lib/documents/pdf-facts";
import { loose } from "@/lib/supabase/loose";

import { extractAcademicDocument } from "./extract-academic";

const BUCKET = "academic-documents";

export interface RunExtractionResult {
  ok?: boolean;
  confidence?: number;
  error?: string;
}

/**
 * Downloads an uploaded document, reads it with the AI (Groq), and writes the
 * result back onto the `academic_documents` row.
 *
 * Status is moved to `extracting` before the call so a second trigger (a
 * student re-tapping, staff re-running) doesn't start a parallel read of the
 * same file — each one spends the free plan's quota and they would race to
 * write the result.
 *
 * A failure is recorded, not thrown: the document stays reviewable and an OSA
 * officer types the figures by hand. Extraction is an accelerator for the
 * human step, never a precondition for it.
 */
export async function runAcademicExtraction(
  documentId: string,
): Promise<RunExtractionResult> {
  const admin = createAdminClient();
  const db = loose(admin);

  const { data: documentRow } = await db
    .from("academic_documents")
    .select("id, student_id, school_year, semester, file_path, mime_type, document_type, processing_status")
    .eq("id", documentId)
    .maybeSingle();

  const document = documentRow as {
    id: string;
    student_id: string;
    school_year: string;
    semester: string;
    file_path: string;
    mime_type: string;
    document_type: "certificate_of_registration" | "rating_slip" | "transcript";
    processing_status: string;
  } | null;
  if (!document) return { error: "Document not found." };

  if (document.processing_status === "verified") {
    return { error: "This document has already been verified." };
  }
  if (document.processing_status === "extracting") {
    return { error: "This document is already being read." };
  }

  await db
    .from("academic_documents")
    .update({ processing_status: "extracting", extraction_error: null })
    .eq("id", document.id);

  const { data: file, error: downloadError } = await admin.storage
    .from(BUCKET)
    .download(document.file_path);

  if (downloadError || !file) {
    await db
      .from("academic_documents")
      .update({
        processing_status: "verification_failed",
        extraction_error: "The uploaded file could not be opened.",
      })
      .eq("id", document.id);
    return { error: "The uploaded file could not be opened." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const outcome = await extractAcademicDocument({
    bytes,
    mediaType: document.mime_type,
    documentType: document.document_type,
    // Ten minutes is ample for the AI service to fetch the photo once.
    signedUrl: async () => {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(document.file_path, 600);
      return data?.signedUrl ?? null;
    },
  });

  if (!outcome.ok) {
    await db
      .from("academic_documents")
      .update({
        // Not 'rejected': the student did nothing wrong, and a human can
        // still read what the model couldn't.
        processing_status: "verification_failed",
        extraction_error: outcome.error,
        extracted_at: new Date().toISOString(),
      })
      .eq("id", document.id);
    return { error: outcome.error };
  }

  await db
    .from("academic_documents")
    .update({
      processing_status: "extracted",
      extracted_data: outcome.data,
      extraction_confidence: outcome.confidence,
      extraction_model: outcome.model,
      extracted_at: new Date().toISOString(),
      extraction_error: outcome.notes,
    })
    .eq("id", document.id);

  // Flags for the officer: whose it is, whether its own figures add up, and
  // what made the file. Stored separately so the extraction itself stays
  // verbatim; a failure here only means the review screen shows no checks.
  try {
    const { data: studentRow } = await db
      .from("students")
      .select("student_number, first_name, last_name")
      .eq("id", document.student_id)
      .maybeSingle();
    const student = studentRow as { student_number: string; first_name: string; last_name: string } | null;
    if (student) {
      const checks = checkDocumentIntegrity({
        documentType: document.document_type,
        data: outcome.data,
        student,
        pdf: await readPdfFacts(bytes),
      });
      const termCheck = await fileUnderPrintedTerm(db, document, outcome.data);
      if (termCheck) checks.unshift(termCheck);
      const { error } = await db.from("academic_documents").update({ integrity_checks: checks }).eq("id", document.id);
      // Before migration 00037 the column does not exist; nothing is lost.
      if (error) console.error("[extraction] integrity checks not saved", error.message);
    }
  } catch (error) {
    console.error("[extraction] integrity checks failed", error);
  }

  return { ok: true, confidence: outcome.confidence };
}

/**
 * Files a document under the term printed on it when that differs from the
 * term chosen at upload. The upload form starts on the current term, but a
 * rating slip is for the term before: one left at the default put a GWA in
 * a term that had not happened yet (found on 2026-10-22). Not done when the
 * student already has that document for the printed term; then the officer
 * is told instead.
 */
async function fileUnderPrintedTerm(
  db: ReturnType<typeof loose>,
  document: { id: string; student_id: string; document_type: string; school_year: string; semester: string },
  data: ExtractedAcademicData,
): Promise<IntegrityCheck | null> {
  const printed = printedTerm(data.school_year, data.semester);
  if (!printed) return null;
  if (printed.schoolYear === document.school_year && printed.semester === document.semester) {
    return { code: "term", status: "pass", detail: `The term printed on it matches: ${printed.semester}, ${printed.schoolYear}.` };
  }
  const uploadedAs = `${document.semester}, ${document.school_year}`;
  const printedAs = `${printed.semester}, ${printed.schoolYear}`;
  const { data: clash } = await db
    .from("academic_documents")
    .select("id")
    .eq("student_id", document.student_id)
    .eq("document_type", document.document_type)
    .eq("school_year", printed.schoolYear)
    .eq("semester", printed.semester)
    .neq("id", document.id)
    .maybeSingle();
  if (clash) {
    return {
      code: "term",
      status: "warn",
      detail: `Uploaded as ${uploadedAs}, but it says ${printedAs}, and the student already has one for that term. Reject this one.`,
    };
  }
  const { error } = await db
    .from("academic_documents")
    .update({ school_year: printed.schoolYear, semester: printed.semester })
    .eq("id", document.id);
  if (error) {
    return { code: "term", status: "warn", detail: `Uploaded as ${uploadedAs}, but it says ${printedAs}. Check the term before verifying.` };
  }
  return {
    code: "term",
    status: "pass",
    detail: `Filed under ${printedAs}, the term printed on it (it was uploaded as ${uploadedAs}).`,
  };
}
