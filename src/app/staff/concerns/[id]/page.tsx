import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon as ArrowLeft, LightningIcon as Zap, BuildingsIcon as Building2, ArrowBendUpLeftIcon as MessageSquareReply } from "@phosphor-icons/react/ssr";

import { modelLabel } from "@/lib/ai/concern-summary";
import { listConcernAttachments } from "@/lib/concerns/attachments";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CONCERN_STUDENT_COLUMNS } from "@/lib/students/columns";
import { ConcernAttachments } from "@/components/concerns/concern-attachments";
import { ResponseForm } from "@/components/concerns/response-form";
import { MarkResolvedButton, StatusUpdater } from "@/components/concerns/status-updater";
import { ConcernRealtime } from "@/components/concerns/concern-realtime";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";
import { formatManila, manilaWallClock, timeAgo } from "@/lib/utils/time";
import { RECEIVED_VIA_LABEL, receivedVia } from "@/lib/concerns/intake";
import { byUrgencyThenNewest } from "@/lib/concerns/queue-order";
import { concernCategoryLabel } from "@/lib/validations/concern";

export const metadata: Metadata = {
  title: "Concern Review",
};

export const revalidate = 0;

interface ConcernDetail {
  id: string;
  category: string;
  subject_line: string;
  body_text: string;
  ai_summary: string | null;
  urgency_level: string | null;
  suggested_dept: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  /** Migration 00036; absent until it runs. */
  received_via?: string;
  referred_by?: string | null;
  /** Migration 00050: a complaint against a student (category "Complaint"). */
  respondent_name?: string | null;
  respondent_details?: string | null;
  incident_date?: string | null;
  incident_location?: string | null;
  /** Migration 00023; absent until it runs. */
  ai_summary_status?: "pending" | "done" | "failed";
  ai_summary_error?: string | null;
  ai_summary_model?: string | null;
  ai_key_issues?: string[] | null;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    email_address: string;
    cellphone: string | null;
    program: string;
    year_level: string;
  } | null;
}

interface QueueRow {
  id: string;
  subject_line: string;
  urgency_level: string | null;
  status: string;
  created_at: string;
}

interface ResponseEntry {
  id: string;
  responder_id: string;
  response_text: string;
  created_at: string;
}

/** The review console reads times on a 24-hour clock. */
const TIMESTAMP: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function shortId(concern: Pick<QueueRow, "id" | "created_at">): string {
  // Convert UUID to mockup-style ID: #C-2026-0148
  // For demo purposes, take last 4 chars and prefix
  const tail = concern.id.replace(/-/g, "").slice(-4).toUpperCase();
  // The year it was filed, not this year: a concern still open in January
  // would otherwise be renumbered overnight. Read on the Manila calendar,
  // since one filed before 8 AM on Jan 1 is still last year in UTC.
  return `#C-${manilaWallClock(new Date(concern.created_at)).year}-${tail}`;
}

// Word count for the "87 words" indicator
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Simple Taglish detector: presence of common Filipino particles
function detectLanguage(text: string): { label: string; code: string } {
  const filipinoMarkers = /\b(po|opo|sana|kasi|naman|talaga|paano|pano|salamat|tapos|nag|naka|maging|sobrang|sobra|yung|ng|mga)\b/i;
  const hasFil = filipinoMarkers.test(text);
  const hasEng = /\b(the|and|or|but|please|how|sorry|thank)\b/i.test(text);
  if (hasFil && hasEng) return { label: "Taglish (EN+FIL)", code: "en+fil" };
  if (hasFil) return { label: "Filipino", code: "fil" };
  return { label: "English", code: "en" };
}

const urgencyBadgeStyles: Record<string, string> = {
  critical: "bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]",
  high:     "bg-[#fef2f2] text-[#b91c1c] border-[#fecaca]",
  medium:   "bg-[#fefce8] text-[#a16207] border-[#fef08a]",
  low:      "bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]",
};

export default async function StaffConcernDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch concern + student
  const { data: concernRaw } = await supabase
    .from("concerns")
    // "*" so the summary state from migration 00023 is included once it
    // exists, without naming columns that would fail the query before then.
    .select(`*, students ( ${CONCERN_STUDENT_COLUMNS} )`)
    .eq("id", id)
    .maybeSingle();

  const concern = concernRaw as unknown as ConcernDetail | null;
  if (!concern) notFound();

  // The queue beside it: the ten most urgent open concerns. Sorted here,
  // not in the query (see queue-order.ts).
  const { data: queueRaw } = await supabase
    .from("concerns")
    .select("id, subject_line, urgency_level, status, created_at")
    .in("status", ["pending", "in_review"]);
  const queue = ((queueRaw as unknown as QueueRow[]) ?? []).sort(byUrgencyThenNewest).slice(0, 10);

  // Fetch responses
  const { data: responsesRaw } = await supabase
    .from("concern_responses")
    .select("id, responder_id, response_text, created_at")
    .eq("concern_id", id)
    .order("created_at", { ascending: true });
  const responses = (responsesRaw as unknown as ResponseEntry[]) ?? [];

  const attachments = await listConcernAttachments(loose(supabase), id);

  // A student's complaint against a student (checklist A3): the case filed from it, if any.
  const isComplaint = concern.category === "Complaint";
  let filedCase: { id: string; case_number: string } | null = null;
  if (isComplaint) {
    const { data: caseRow } = await loose(supabase)
      .from("violation_cases")
      .select("id, case_number")
      .eq("source_concern_id", id)
      .maybeSingle();
    filedCase = (caseRow as { id: string; case_number: string } | null) ?? null;
  }

  const student = concern.students;
  const studentName = student
    ? `${student.first_name} ${student.last_name}`
    : "Unknown";
  const lang = detectLanguage(concern.body_text);
  const words = wordCount(concern.body_text);
  const isClosed = concern.status === "closed";
  const totalQueue = queue.length;
  const highUrgencyCount = queue.filter(
    (q) => q.urgency_level === "high" || q.urgency_level === "critical"
  ).length;

  return (
    <div>
      <ConcernRealtime concernId={id} />

      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Student concerns", href: "/staff/concerns" },
          { label: shortId(concern) },
        ]}
        title="Concern Review"
      >
        <span className="text-sm text-muted-foreground font-mono mr-2">
          {totalQueue} in queue · {highUrgencyCount} high urgency
        </span>
        <Link
          href="/staff/concerns"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium bg-card border border-border hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to queue
        </Link>
      </PageHeader>

      {/* Side-by-side: queue panel + detail panel */}
      <div className="grid lg:grid-cols-[280px_1fr] gap-0 bg-card border border-border rounded-md overflow-hidden">
        {/* QUEUE PANEL */}
        <aside className="bg-accent border-r border-border p-4 lg:max-h-[calc(100vh-280px)] lg:overflow-y-auto">
          <div className="flex justify-between items-center pb-3 mb-3 border-b border-border">
            <h4 className="text-base font-semibold">Queue</h4>
            <span className="font-mono text-sm text-muted-foreground bg-card px-2 py-1 rounded-full border border-border">
              All · {totalQueue}
            </span>
          </div>

          <div className="space-y-2">
            {queue.map((q) => {
              const isActive = q.id === id;
              return (
                <Link
                  key={q.id}
                  href={`/staff/concerns/${q.id}`}
                  className={cn(
                    "block bg-card border rounded-md px-3 py-2.5 transition-all",
                    isActive
                      ? "border-tup-maroon-600 shadow-[0_0_0_3px_rgba(122,31,43,0.08)]"
                      : "border-border hover:border-tup-maroon-300"
                  )}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="font-mono text-sm text-muted-foreground">
                      {shortId(q)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {timeAgo(q.created_at)}
                    </span>
                  </div>
                  <div className="text-sm font-medium leading-tight mb-1.5 line-clamp-2">
                    {q.subject_line}
                  </div>
                  {q.urgency_level && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-sm font-semibold px-1.5 py-0.5 rounded-full border",
                        urgencyBadgeStyles[q.urgency_level] ||
                          "bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {q.urgency_level}
                    </span>
                  )}
                </Link>
              );
            })}
            {queue.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Queue is empty.
              </p>
            )}
          </div>
        </aside>

        {/* DETAIL PANEL */}
        <div className="p-6 lg:p-7">
          {/* Detail header */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-5 pb-5 border-b border-border">
            <div className="min-w-0">
              <div className="font-mono text-sm text-muted-foreground mb-1">
                {shortId(concern)} ·{" "}
                {receivedVia(concern.received_via) === "online"
                  ? "Submitted"
                  : `${RECEIVED_VIA_LABEL[receivedVia(concern.received_via)]}${concern.referred_by ? ` (${concern.referred_by})` : ""}, recorded by the OSA`}{" "}
                {formatManila(concern.created_at, TIMESTAMP)}
              </div>
              <h2 className="text-lg font-semibold tracking-tight mb-2 text-balance">
                {concern.subject_line}
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>
                  <strong className="text-foreground font-medium">
                    {studentName}
                  </strong>
                  {student && ` · ${student.program} ${student.year_level}`}
                </span>
                <span>
                  Category:{" "}
                  <strong className="text-foreground font-medium">
                    {concernCategoryLabel(concern.category)}
                  </strong>
                </span>
                <span className="flex items-center gap-1">
                  Status:{" "}
                  {/* Keyed on the status so a change made elsewhere (Mark
                      Resolved, another officer via realtime) remounts it;
                      its optimistic state would otherwise keep the old value. */}
                  <StatusUpdater
                    key={concern.status}
                    concernId={id}
                    currentStatus={concern.status}
                    hasAiSummary={!!concern.ai_summary}
                  />
                </span>
              </div>
            </div>
            {student && (
              <Link
                href={`/staff/students/${student.id}`}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium bg-card border border-border hover:bg-muted transition-colors"
              >
                View student profile →
              </Link>
            )}
          </div>

          {/* A complaint against a student: who, when, and the case it became */}
          {isComplaint && (
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50/60 p-4 text-base dark:border-amber-800 dark:bg-amber-950/20">
              <dl className="grid min-w-0 gap-x-6 gap-y-1 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Complaint against</dt>
                  <dd className="font-medium">
                    {concern.respondent_name ?? "—"}
                    {concern.respondent_details ? ` · ${concern.respondent_details}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">When and where</dt>
                  <dd className="font-medium">
                    {concern.incident_date ?? "—"}
                    {concern.incident_location ? ` · ${concern.incident_location}` : ""}
                  </dd>
                </div>
              </dl>
              {filedCase ? (
                <Link
                  href={`/staff/cases/${filedCase.id}`}
                  className="shrink-0 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  Filed as {filedCase.case_number} →
                </Link>
              ) : (
                <Link
                  href={`/staff/cases/new?from_concern=${id}`}
                  className="shrink-0 rounded-md bg-tup-maroon-600 px-3 py-2 text-sm font-medium text-white hover:bg-tup-maroon-700"
                >
                  File a case from this complaint
                </Link>
              )}
            </div>
          )}

          {/* Side-by-side concern panels */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* ORIGINAL SUBMISSION PANEL */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className="bg-accent border-b border-border px-3.5 py-2.5 flex justify-between items-center">
                <span className="text-sm font-semibold text-muted-foreground">
                  📝 Original Submission
                </span>
                <span className="text-sm text-muted-foreground font-mono">
                  {words} words
                </span>
              </div>
              <div className="p-4">
                <p className="text-base leading-[1.65] italic text-balance">
                  &ldquo;{concern.body_text}&rdquo;
                </p>
                <span className="inline-block mt-3 not-italic font-mono text-sm text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  Detected: {lang.label}
                </span>
              </div>
            </div>

            {/* AI SUMMARY PANEL */}
            <div className="border border-ai-accent rounded-md overflow-hidden">
              <div className="bg-ai-accent-soft border-b border-ai-accent px-3.5 py-2.5 flex justify-between items-center">
                <span className="text-sm font-semibold text-ai-accent flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  AI-Generated Summary
                </span>
                {/* The model that actually wrote this summary — a fallback
                    may have answered in place of the one requested. */}
                <span className="inline-flex items-center gap-1 text-sm font-semibold px-1.5 py-0.5 rounded-full bg-ai-accent-soft text-ai-accent border border-ai-accent">
                  {modelLabel(concern.ai_summary_model)}
                </span>
              </div>
              <div className="p-4">
                {concern.ai_summary ? (
                  <>
                    <p className="text-base leading-relaxed mb-4">
                      {concern.ai_summary}
                    </p>
                    <div className="border-t border-border pt-3.5 space-y-0">
                      <AiField label="urgency_level">
                        {concern.urgency_level && (
                          <span
                            className={cn(
                              "inline-flex items-center text-sm font-semibold px-1.5 py-0.5 rounded-full border",
                              urgencyBadgeStyles[concern.urgency_level] ||
                                "bg-muted text-muted-foreground border-border"
                            )}
                          >
                            {concern.urgency_level}
                          </span>
                        )}
                      </AiField>
                      {concern.suggested_dept && (
                        <AiField label="recommended_dept">
                          <span className="text-sm font-medium flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {concern.suggested_dept}
                          </span>
                        </AiField>
                      )}
                      {concern.ai_key_issues && concern.ai_key_issues.length > 0 && (
                        <AiField label="key_issues">
                          <span className="text-sm font-medium">
                            {concern.ai_key_issues.join(" · ")}
                          </span>
                        </AiField>
                      )}
                      <AiField label="detected_language">
                        <span className="text-sm font-medium">
                          {lang.label}
                        </span>
                      </AiField>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3.5 pt-3 border-t border-ai-accent text-sm text-ai-accent font-mono">
                      <Zap className="h-3 w-3" />
                      Generated · Reviewable · See audit log
                    </div>
                  </>
                ) : concern.ai_summary_status === "failed" ? (
                  <div className="text-center py-8">
                    <p className="text-base font-medium mb-2">No AI summary for this concern</p>
                    <p className="text-sm text-muted-foreground">
                      {concern.ai_summary_error ?? "The AI could not summarize it."} Read the
                      concern in full, or use &ldquo;Re-analyze&rdquo; in the status row to try
                      again.
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-base text-muted-foreground italic mb-2">
                      AI analysis pending...
                    </p>
                    {/* A held queue (no credit, bad key) says why it is waiting. */}
                    {concern.ai_summary_error ? (
                      <p className="text-sm text-amber-800">{concern.ai_summary_error}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        It usually appears within a minute of the concern being filed. Use
                        &ldquo;Re-analyze&rdquo; in the status row to run it now.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Files the student attached when filing */}
          {attachments.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                📎 Attachments · {attachments.length}
              </h3>
              <ConcernAttachments attachments={attachments} />
            </div>
          )}

          {/* Action row. The mockup also had "Reassign Department" and
              "Flag", but nothing stores a reassignment or a flag (concerns
              has no such columns), so the buttons did nothing and were
              removed rather than left promising it. */}
          <div className="grid grid-cols-2 gap-2 mb-6 pt-5 border-t border-border">
            {/* A plain in-page link: the reply form is the whole of
                responding, this only saves the scroll on a long concern. */}
            {!isClosed && (
              <a
                href="#reply"
                className="px-3 py-2 rounded-md text-sm font-medium bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 transition-colors inline-flex items-center justify-center gap-1"
              >
                <MessageSquareReply className="h-3.5 w-3.5" />
                Respond to Student
              </a>
            )}
            <MarkResolvedButton concernId={id} currentStatus={concern.status} />
          </div>

          {/* Response thread */}
          {responses.length > 0 && (
            <div className="mb-6 border-t border-border pt-5">
              <h3 className="text-base font-semibold mb-3">
                Conversation · {responses.length}{" "}
                {responses.length === 1 ? "reply" : "replies"}
              </h3>
              <div className="space-y-3">
                {responses.map((response) => {
                  const isStaff = response.responder_id !== user.id;
                  return (
                    <div
                      key={response.id}
                      className={cn(
                        "border rounded-md p-3.5",
                        isStaff
                          ? "border-tup-maroon-200 bg-tup-maroon-50/30"
                          : "border-border bg-card"
                      )}
                    >
                      <div className="flex justify-between items-center mb-1.5">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            isStaff ? "text-tup-maroon-600" : "text-muted-foreground"
                          )}
                        >
                          {isStaff ? "Staff" : "Student"}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {formatManila(response.created_at, TIMESTAMP)}
                        </span>
                      </div>
                      <p className="text-base whitespace-pre-wrap leading-relaxed">
                        {response.response_text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reply form; scroll-mt clears the sticky site header. */}
          <div id="reply" className="border-t border-border pt-5 scroll-mt-20">
            <ResponseForm
              concernId={id}
              responderRole="staff"
              disabled={isClosed}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// AI structured field row
function AiField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 text-sm">
      <span className="text-muted-foreground font-mono text-sm">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
