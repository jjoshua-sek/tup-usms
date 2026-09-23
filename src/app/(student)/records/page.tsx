import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, GraduationCap, TrendingDown, TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { DocumentUpload } from "@/components/records/document-upload";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentTerm } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaDate } from "@/lib/utils/time";
import type { AcademicDocument, AcademicSnapshot } from "@/types/osa";

export const metadata: Metadata = {
  title: "Academic Records",
};

const DOC_LABELS: Record<string, string> = {
  certificate_of_registration: "Certificate of Registration",
  rating_slip: "Rating slip",
  transcript: "Transcript of records",
};

const PROCESSING_META: Record<string, { label: string; tone: Tone; hint: string }> = {
  uploaded: {
    label: "Awaiting review",
    tone: "info",
    hint: "The OSA will read and verify this.",
  },
  extracting: { label: "Reading", tone: "info", hint: "Figures are being extracted." },
  extracted: {
    label: "Needs verification",
    tone: "warning",
    hint: "Extracted — an OSA officer still has to confirm the numbers.",
  },
  verification_failed: {
    label: "Could not read",
    tone: "warning",
    hint: "The image wasn't legible. Upload a clearer photo.",
  },
  verified: {
    label: "Verified",
    tone: "success",
    hint: "Confirmed by the OSA and counted in your record.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    hint: "See the reason below and upload a replacement.",
  },
};

/**
 * Academic records the student contributes themselves.
 *
 * TUP's enrolment system is a separate platform, so rather than integrating
 * with it, the student uploads the two documents they already receive from
 * it. Verified figures become `academic_snapshots` — the slim per-term table
 * the early warning model reads.
 *
 * Note what is NOT on this page: the risk score. Students see support offered
 * to them, never a predictive label attached to their name.
 */
export default async function RecordsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = loose(supabase);
  const term = getCurrentTerm();

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) redirect("/profile");

  const [{ data: documentRows }, { data: snapshotRows }] = await Promise.all([
    db
      .from("academic_documents")
      .select("*")
      .eq("student_id", student.id)
      .order("uploaded_at", { ascending: false }),
    db
      .from("academic_snapshots")
      .select("*")
      .eq("student_id", student.id)
      .order("term_sequence", { ascending: false }),
  ]);

  const documents = (documentRows as AcademicDocument[] | null) ?? [];
  const snapshots = (snapshotRows as AcademicSnapshot[] | null) ?? [];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Academic Records" }]}
        title="Academic Records"
        description="Upload the Certificate of Registration and rating slip you get from the TUP ERS. The OSA verifies them, and your class schedule fills in automatically."
      />

      <div className="mb-6">
        <DocumentUpload
          defaultSchoolYear={term.schoolYear}
          defaultSemester={term.semester}
        />
      </div>

      {/* Verified term history */}
      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
          Verified terms
        </h2>
        {snapshots.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No verified terms yet"
            description="Once the OSA verifies a rating slip, that term's GWA and units appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-[13px]">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Term</th>
                  <th className="px-4 py-2.5 font-medium">GWA</th>
                  <th className="px-4 py-2.5 font-medium">Units</th>
                  <th className="px-4 py-2.5 font-medium">Failed</th>
                  <th className="px-4 py-2.5 font-medium">Standing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.map((snapshot, index) => {
                  const previous = snapshots[index + 1];
                  // Philippine scale: 1.00 is best, so a HIGHER later GWA is a decline.
                  const delta =
                    snapshot.gwa != null && previous?.gwa != null
                      ? Number(snapshot.gwa) - Number(previous.gwa)
                      : null;

                  return (
                    <tr key={snapshot.id}>
                      <td className="px-4 py-2.5">
                        {snapshot.semester}, {snapshot.school_year}
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {snapshot.gwa != null ? Number(snapshot.gwa).toFixed(2) : "—"}
                          {delta != null && Math.abs(delta) >= 0.01 && (
                            <span
                              className={
                                delta > 0 ? "text-red-600" : "text-emerald-600"
                              }
                              title={delta > 0 ? "Declined" : "Improved"}
                            >
                              {delta > 0 ? (
                                <TrendingDown className="h-3.5 w-3.5" />
                              ) : (
                                <TrendingUp className="h-3.5 w-3.5" />
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {snapshot.units_passed ?? "—"}/{snapshot.units_enrolled ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {snapshot.units_failed ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">{snapshot.scholastic_status ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Uploads */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
          Your uploads
        </h2>
        {documents.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing uploaded yet"
            description="Upload your latest rating slip so scholarship eligibility can be checked against your real GWA."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {documents.map((document) => {
              const meta =
                PROCESSING_META[document.processing_status] ?? PROCESSING_META.uploaded;
              return (
                <li key={document.id} className="flex items-start gap-3 px-4 py-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {DOC_LABELS[document.document_type] ?? document.document_type}
                      <span className="ml-2 text-muted-foreground">
                        {document.semester}, {document.school_year}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {document.file_name} · uploaded {formatManilaDate(document.uploaded_at)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {document.rejection_reason ?? meta.hint}
                    </p>
                  </div>
                  <ToneBadge label={meta.label} tone={meta.tone} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Why we ask:</strong> grades and units let the
        OSA spot students who may need academic support early, and let scholarship
        eligibility be checked against real figures instead of estimates. Files are private,
        kept in encrypted storage, and used only for those purposes (RA 10173).
      </p>
    </div>
  );
}
