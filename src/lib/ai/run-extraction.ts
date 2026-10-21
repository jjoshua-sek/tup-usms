import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkDocumentIntegrity } from "@/lib/documents/integrity";
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
    .select("id, student_id, file_path, mime_type, document_type, processing_status")
    .eq("id", documentId)
    .maybeSingle();

  const document = documentRow as {
    id: string;
    student_id: string;
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
      const { error } = await db.from("academic_documents").update({ integrity_checks: checks }).eq("id", document.id);
      // Before migration 00037 the column does not exist; nothing is lost.
      if (error) console.error("[extraction] integrity checks not saved", error.message);
    }
  } catch (error) {
    console.error("[extraction] integrity checks failed", error);
  }

  return { ok: true, confidence: outcome.confidence };
}
