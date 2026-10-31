import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, FileMagnifyingGlassIcon as FileSearch, ShieldCheckIcon as ShieldCheck, SparkleIcon as Sparkles, WarningIcon as TriangleAlert } from "@phosphor-icons/react/ssr";

import {
  DocumentReviewForms,
  RerunExtractionButton,
  ViewFileButton,
} from "@/components/documents/document-review";
import { StampedScanPanel } from "@/components/documents/stamped-scan-panel";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { flaggedChecks, type IntegrityCheck } from "@/lib/documents/integrity";
import { getStaffContext } from "@/lib/osa/staff-context";
import { WAITING } from "@/lib/osa/today";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDayTime } from "@/lib/utils/time";
import type { AcademicDocument } from "@/types/osa";

export const metadata: Metadata = {
  title: "Check documents",
};

export const revalidate = 20;

const DOC_LABELS: Record<string, string> = {
  certificate_of_registration: "Certificate of Registration",
  rating_slip: "Rating slip",
  transcript: "Transcript",
};

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  extracting: "Being read",
  extracted: "Read, needs checking",
  verification_failed: "Could not be read",
  verified: "Verified",
  rejected: "Rejected",
};

/** How many already-checked documents the folded list shows. */
const CHECKED_SHOWN = 30;

const COLUMNS = "*, students(id, first_name, last_name, student_number, program)";

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
        title="Check documents"
        audience="Academic document verification is handled by OSA officers."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  // Two reads, so the queue never loses rows to a cap filled by old ones:
  // everything still to check, then the most recently checked.
  const [{ data: pendingRows }, { data: checkedRows }] = await Promise.all([
    db
      .from("academic_documents")
      .select(COLUMNS)
      .in("processing_status", [...WAITING.documentsToCheck])
      .order("uploaded_at", { ascending: true })
      .limit(200),
    db
      .from("academic_documents")
      .select(COLUMNS)
      .in("processing_status", ["verified", "rejected"])
      .order("uploaded_at", { ascending: false })
      .limit(CHECKED_SHOWN),
  ]);

  // Shared with the home page's "Today" list.
  const pending = (pendingRows as DocumentRow[] | null) ?? [];
  const checked = (checkedRows as DocumentRow[] | null) ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Check documents" }]}
        title="Check documents"
        description="Compare each uploaded rating slip or COR with the Registrar-stamped copy, then verify or reject it. Verified figures feed scholarship eligibility and the at-risk list."
      />

      {pending.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="Nothing waiting to be checked"
          description="Students upload their COR and rating slip from Academic Records. Until something is verified here, most risk scores stay low-confidence."
        />
      ) : (
        <Group title="Waiting to be checked" documents={pending} actionable />
      )}

      {checked.length > 0 && (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            Already checked
            <span className="font-normal text-muted-foreground">
              ({checked.length === CHECKED_SHOWN ? `the last ${CHECKED_SHOWN}` : checked.length}, verified or rejected)
            </span>
          </summary>
          <div className="border-t border-border p-4">
            <ul className="space-y-3">
              {checked.map((document) => (
                <DocumentItem key={document.id} document={document} actionable={false} />
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

/** What the automatic checks found: flags spelled out, passes counted. */
function IntegrityFlags({ checks }: { checks: IntegrityCheck[] | null | undefined }) {
  if (!checks || checks.length === 0) return null;
  const flags = flaggedChecks(checks);
  const passed = checks.filter((check) => check.status === "pass").length;
  if (flags.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-base text-muted-foreground">
        <ShieldCheck className="h-4 w-4" /> {passed} automatic check{passed === 1 ? "" : "s"} passed (name, number, figures, file).
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-md bg-amber-50 p-3 text-base leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="flex items-center gap-1.5 font-semibold">
        <TriangleAlert className="h-4 w-4" /> Check before verifying
      </p>
      <ul className="ml-4 mt-1 list-disc">
        {flags.map((flag) => (
          <li key={flag.code}>{flag.detail}</li>
        ))}
      </ul>
      <p className="mt-1 opacity-80">A flag can also be a misread figure. The stamped copy settles it.</p>
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
  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
          {documents.length}
        </span>
      </h2>

      <ul className="space-y-3">
        {documents.map((document) => (
          <DocumentItem key={document.id} document={document} actionable={actionable} />
        ))}
      </ul>
    </section>
  );
}

function DocumentItem({ document, actionable }: { document: DocumentRow; actionable: boolean }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-semibold">
              {DOC_LABELS[document.document_type] ?? document.document_type}
            </p>
            <ToneBadge
              label={STATUS_LABEL[document.processing_status] ?? document.processing_status}
              tone={STATUS_TONE[document.processing_status] ?? "neutral"}
            />
            {document.processing_status === "verified" && (
              <ToneBadge
                label={document.verification_method === "counter_scan" ? "with stamped copy" : "on screen"}
                tone={document.verification_method === "counter_scan" ? "success" : "neutral"}
              />
            )}
            <span className="text-sm text-muted-foreground">
              {document.semester}, {document.school_year}
            </span>
          </div>

          <p className="mt-1 text-base">
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
            <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
              {document.students?.student_number}
            </span>
          </p>

          <p className="mt-0.5 text-sm text-muted-foreground">
            {document.file_name} · {Math.round(document.file_size / 1024)} KB · uploaded{" "}
            {formatManilaMonthDayTime(document.uploaded_at)}
          </p>

          {document.rejection_reason && (
            <p className="mt-1.5 rounded-md bg-muted p-2 text-sm">
              <strong>Rejected:</strong> {document.rejection_reason}
            </p>
          )}
          {document.verification_notes && (
            <p className="mt-1.5 text-sm text-muted-foreground">
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
          className={`mt-2 flex items-start gap-1.5 rounded-md p-2 text-sm leading-relaxed ${
            document.extraction_confidence < 0.6
              ? "bg-amber-50 text-amber-900"
              : "bg-ai-accent-soft text-ai-accent"
          }`}
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Read with {Math.round(document.extraction_confidence * 100)}% confidence
            {document.extraction_model ? ` (${document.extraction_model})` : ""}.
            {document.extraction_confidence < 0.6 &&
              " That is low: check every figure against the page, or read it again."}
            {document.extraction_error && ` Note: ${document.extraction_error}`}
          </span>
        </p>
      )}

      <IntegrityFlags checks={document.integrity_checks} />

      {actionable && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {document.extracted_data && document.document_type !== "transcript" && (
            <StampedScanPanel
              documentId={document.id}
              documentLabel={(DOC_LABELS[document.document_type] ?? "document").toLowerCase()}
              initial={document.scan_comparison}
            />
          )}
          <DocumentReviewForms
            documentId={document.id}
            documentType={document.document_type}
            extracted={document.corrected_data ?? document.extracted_data}
          />
        </div>
      )}
    </li>
  );
}
