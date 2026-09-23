import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, FileSearch, FolderOpen, Sparkles } from "lucide-react";

import {
  DocumentReviewForms,
  RerunExtractionButton,
  ViewFileButton,
} from "@/components/documents/document-review";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDayTime } from "@/lib/utils/time";
import type { AcademicDocument } from "@/types/osa";

export const metadata: Metadata = {
  title: "Document Review",
};

export const revalidate = 20;

const DOC_LABELS: Record<string, string> = {
  certificate_of_registration: "Certificate of Registration",
  rating_slip: "Rating slip",
  transcript: "Transcript",
};

const STATUS_TONE: Record<string, Tone> = {
  uploaded: "info",
  extracting: "info",
  extracted: "warning",
  verification_failed: "warning",
  verified: "success",
  rejected: "danger",
};

interface DocumentRow extends AcademicDocument {
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
  } | null;
}

/**
 * The verification desk for student-uploaded academic records.
 *
 * Everything the early warning model knows about grades passes through here.
 * Verifying writes an `academic_snapshots` row under the officer's name; the
 * score on /staff/risk changes on the next load, traceable to this decision.
 */
export default async function StaffDocumentsPage() {
  const staff = await getStaffContext();
  if (!staff?.isOsa) {
    return (
      <RestrictedNotice
        title="Document Review"
        audience="Academic document verification is handled by OSA officers."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("academic_documents")
    .select(
      "*, students(id, first_name, last_name, student_number, program)",
    )
    .order("uploaded_at", { ascending: true })
    .limit(200);

  const documents = (rows as DocumentRow[] | null) ?? [];
  const pending = documents.filter((document) =>
    ["uploaded", "extracted", "extracting", "verification_failed"].includes(
      document.processing_status,
    ),
  );
  const verified = documents.filter((document) => document.processing_status === "verified");
  const rejected = documents.filter((document) => document.processing_status === "rejected");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Document Review" }]}
        title="Document Review"
        description="Confirm the figures on uploaded rating slips and CORs. Verified figures feed scholarship eligibility and the early warning list."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard
          label="Waiting"
          value={pending.length}
          icon={FileSearch}
          iconTone={pending.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard label="Verified" value={verified.length} icon={CheckCircle2} iconTone="success" />
        <StatsCard label="Rejected" value={rejected.length} icon={FolderOpen} />
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="Nothing uploaded yet"
          description="Students upload their COR and rating slip from Academic Records. Until something is verified here, most risk scores stay low-confidence."
        />
      ) : (
        <div className="space-y-8">
          <Group title="Waiting for review" documents={pending} actionable />
          <Group title="Verified" documents={verified} actionable={false} />
          <Group title="Rejected" documents={rejected} actionable={false} />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  documents,
  actionable,
}: {
  title: string;
  documents: DocumentRow[];
  actionable: boolean;
}) {
  if (documents.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {documents.length}
        </span>
      </h2>

      <ul className="space-y-3">
        {documents.map((document) => (
          <li key={document.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[14px] font-semibold">
                    {DOC_LABELS[document.document_type] ?? document.document_type}
                  </p>
                  <ToneBadge
                    label={document.processing_status.replace(/_/g, " ")}
                    tone={STATUS_TONE[document.processing_status] ?? "neutral"}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {document.semester}, {document.school_year}
                  </span>
                </div>

                <p className="mt-1 text-[13px]">
                  {document.students ? (
                    <Link
                      href={`/staff/students/${document.students.id}`}
                      className="text-tup-maroon-600 underline-offset-2 hover:underline"
                    >
                      {document.students.first_name} {document.students.last_name}
                    </Link>
                  ) : (
                    "Unknown student"
                  )}
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {document.students?.student_number}
                  </span>
                </p>

                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {document.file_name} · {Math.round(document.file_size / 1024)} KB · uploaded{" "}
                  {formatManilaMonthDayTime(document.uploaded_at)}
                </p>

                {document.rejection_reason && (
                  <p className="mt-1.5 rounded-md bg-muted p-2 text-[12px]">
                    <strong>Rejected:</strong> {document.rejection_reason}
                  </p>
                )}
                {document.verification_notes && (
                  <p className="mt-1.5 text-[12px] text-muted-foreground">
                    {document.verification_notes}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <ViewFileButton documentId={document.id} />
                {actionable && <RerunExtractionButton documentId={document.id} />}
              </div>
            </div>

            {/* What the model made of it — including how sure it was */}
            {document.extraction_confidence != null && (
              <p
                className={`mt-2 flex items-start gap-1.5 rounded-md p-2 text-[11px] leading-relaxed ${
                  document.extraction_confidence < 0.6
                    ? "bg-amber-50 text-amber-900"
                    : "bg-ai-accent-soft text-ai-accent"
                }`}
              >
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Read with {Math.round(document.extraction_confidence * 100)}% confidence
                  {document.extraction_model ? ` (${document.extraction_model})` : ""}.
                  {document.extraction_confidence < 0.6 &&
                    " Low — check every figure against the page, or re-read it."}
                  {document.extraction_error && ` Note: ${document.extraction_error}`}
                </span>
              </p>
            )}

            {actionable && (
              <div className="mt-3 border-t border-border pt-3">
                <DocumentReviewForms
                  documentId={document.id}
                  documentType={document.document_type}
                  extracted={document.corrected_data ?? document.extracted_data}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
