import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CaretDownIcon as ChevronDown, LightningIcon as Zap, ArrowBendUpLeftIcon as MessageSquareReply, PaperclipIcon as Paperclip, UserIcon } from "@phosphor-icons/react/ssr";

import { modelLabel } from "@/lib/ai/concern-summary";
import { listConcernAttachments } from "@/lib/concerns/attachments";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CONCERN_STUDENT_COLUMNS } from "@/lib/students/columns";
import { ConcernAttachments } from "@/components/concerns/concern-attachments";
import { ResponseForm } from "@/components/concerns/response-form";
import { MarkResolvedButton, StatusUpdater } from "@/components/concerns/status-updater";
import { ConcernRealtime } from "@/components/concerns/concern-realtime";
import { UrgencyBadge } from "@/components/concerns/urgency-badge";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatManilaDateTime, manilaWallClock, timeAgo } from "@/lib/utils/time";
import { RECEIVED_VIA_LABEL, receivedVia } from "@/lib/concerns/intake";
import { byUrgencyThenNewest } from "@/lib/concerns/queue-order";
import { concernCategoryLabel } from "@/lib/validations/concern";

export const metadata: Metadata = {
  title: "Concern",
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
    user_id: string | null;
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

/** How many open concerns the "Other open concerns" list shows. */
const QUEUE_SHOWN = 10;

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
  if (hasFil && hasEng) return { label: "Taglish (English and Filipino)", code: "en+fil" };
  if (hasFil) return { label: "Filipino", code: "fil" };
  return { label: "English", code: "en" };
}

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
    .select(`*, students ( ${CONCERN_STUDENT_COLUMNS}, user_id )`)
    .eq("id", id)
    .maybeSingle();

  const concern = concernRaw as unknown as ConcernDetail | null;
  if (!concern) notFound();

  // The other open concerns, most urgent first. Sorted here, not in the
  // query (see queue-order.ts).
  const { data: queueRaw } = await supabase
    .from("concerns")
    .select("id, subject_line, urgency_level, status, created_at")
    .in("status", ["pending", "in_review"]);
  const openConcerns = ((queueRaw as unknown as QueueRow[]) ?? []).sort(byUrgencyThenNewest);
  const others = openConcerns.filter((q) => q.id !== id);
  const urgentOthers = others.filter((q) => q.urgency_level === "high" || q.urgency_level === "critical").length;

  // Fetch responses
  const { data: responsesRaw } = await supabase
    .from("concern_responses")
    .select("id, responder_id, response_text, created_at")
    .eq("concern_id", id)
    .order("created_at", { ascending: true });
  const responses = (responsesRaw as unknown as ResponseEntry[]) ?? [];

  // Who wrote each reply. The student is the concern's own account; anyone
  // else is staff, named through staff_names() (00024).
  const student = concern.students;
  const studentUserId = student?.user_id ?? null;
  const staffIds = [...new Set(responses.map((r) => r.responder_id).filter((rid) => rid !== studentUserId))];
  const staffNames = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: namesRaw } = await loose(supabase).rpc("staff_names", { p_user_ids: staffIds });
    for (const row of (namesRaw as { user_id: string; full_name: string }[] | null) ?? []) {
      staffNames.set(row.user_id, row.full_name);
    }
  }

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

  const studentName = student
    ? `${student.first_name} ${student.last_name}`
    : "Unknown student";
  const lang = detectLanguage(concern.body_text);
  const words = wordCount(concern.body_text);
  const isClosed = concern.status === "closed";
  const via = receivedVia(concern.received_via);
  const receivedLine =
    via === "online"
      ? "Sent through the online form"
      : `${RECEIVED_VIA_LABEL[via]}${concern.referred_by ? ` (${concern.referred_by})` : ""}, recorded by the OSA`;

  return (
    <div className="space-y-6">
      <ConcernRealtime concernId={id} />

      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Student concerns", href: "/staff/concerns" },
          { label: shortId(concern) },
        ]}
        title={concern.subject_line}
        description={`From ${studentName}, ${timeAgo(concern.created_at)}.`}
      >
        {student && (
          <Link href={`/staff/students/${student.id}`} className={cn(buttonVariants({ variant: "outline" }), "gap-1.5")}>
            <UserIcon className="h-4 w-4" />
            Open student record
          </Link>
        )}
      </PageHeader>

      {/* What to do with it: status, reply, resolve. */}
      <section aria-label="Actions" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
        {/* Keyed on the status so a change made elsewhere (Mark as resolved,
            another officer via realtime) remounts it; its optimistic state
            would otherwise keep the old value. */}
        <StatusUpdater
          key={concern.status}
          concernId={id}
          currentStatus={concern.status}
          hasAiSummary={!!concern.ai_summary}
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {/* A plain in-page link: the reply form is the whole of
              responding, this only saves the scroll on a long concern. */}
          {!isClosed && (
            <a
              href="#reply"
              className={cn(buttonVariants(), "gap-1.5 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
            >
              <MessageSquareReply className="h-4 w-4" />
              Reply to the student
            </a>
          )}
          <MarkResolvedButton concernId={id} currentStatus={concern.status} />
        </div>
      </section>

      {/* The facts, as label and value. */}
      <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-border bg-card p-4 text-base sm:grid-cols-2 xl:grid-cols-3">
        <Fact label="Student">
          {studentName}
          {student?.student_number && (
            <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">{student.student_number}</span>
          )}
        </Fact>
        {student && <Fact label="Program and year">{student.program}, {student.year_level}</Fact>}
        <Fact label="Category">{concernCategoryLabel(concern.category)}</Fact>
        <Fact label="Urgency">
          <UrgencyBadge level={concern.urgency_level} />
        </Fact>
        <Fact label="Received">
          {receivedLine}, {formatManilaDateTime(concern.created_at)}
        </Fact>
        <Fact label="Reference number">
          <span className="whitespace-nowrap font-mono text-sm">{shortId(concern)}</span>
        </Fact>
      </dl>

      {/* A complaint against a student: who, when, and the case it became */}
      {isComplaint && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-base dark:border-amber-800 dark:bg-amber-950/20">
          <dl className="grid min-w-0 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Fact label="Complaint against">
              {concern.respondent_name ?? "Not given"}
              {concern.respondent_details ? `, ${concern.respondent_details}` : ""}
            </Fact>
            <Fact label="When and where">
              {concern.incident_date ?? "Not given"}
              {concern.incident_location ? `, ${concern.incident_location}` : ""}
            </Fact>
          </dl>
          {filedCase ? (
            <Link href={`/staff/cases/${filedCase.id}`} className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
              Open case {filedCase.case_number}
            </Link>
          ) : (
            <Link
              href={`/staff/cases/new?from_concern=${id}`}
              className={cn(buttonVariants(), "shrink-0 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
            >
              File a case from this complaint
            </Link>
          )}
        </div>
      )}

      {/* What the student wrote, and the AI's summary of it. Side by side
          only on wide screens, so neither is squeezed. */}
      <div className="grid gap-4 2xl:grid-cols-2">
        <section className="rounded-lg border border-border bg-card">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">What the student wrote</h2>
            <span className="text-sm text-muted-foreground">
              {words} words · {lang.label}
            </span>
          </header>
          <p className="max-w-prose whitespace-pre-wrap p-4 text-base leading-relaxed">{concern.body_text}</p>
        </section>

        <section className="rounded-lg border border-ai-accent bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ai-accent bg-ai-accent-soft px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-ai-accent">
              <Zap className="h-4 w-4" />
              Summary written by AI
            </h2>
            {/* The model that actually wrote this summary — a fallback
                may have answered in place of the one requested. */}
            <span className="rounded-full border border-ai-accent bg-card px-2 py-0.5 text-sm font-medium text-ai-accent">
              {modelLabel(concern.ai_summary_model)}
            </span>
          </header>
          <div className="p-4">
            {concern.ai_summary ? (
              <>
                <p className="max-w-prose text-base leading-relaxed">{concern.ai_summary}</p>
                <dl className="mt-4 space-y-2 border-t border-border pt-4 text-base">
                  {concern.suggested_dept && <Fact label="Suggested office" inline>{concern.suggested_dept}</Fact>}
                  {concern.ai_key_issues && concern.ai_key_issues.length > 0 && (
                    <Fact label="Key issues" inline>{concern.ai_key_issues.join(", ")}</Fact>
                  )}
                </dl>
                <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
                  Check the summary against what the student wrote. Every change to this concern is kept in Activity history.
                </p>
              </>
            ) : concern.ai_summary_status === "failed" ? (
              <div className="py-6 text-center">
                <p className="mb-2 text-base font-medium">No summary for this concern</p>
                <p className="text-base text-muted-foreground">
                  {concern.ai_summary_error ?? "The AI could not summarize it."} Read what the student wrote, or press
                  &ldquo;Write a summary&rdquo; above to try again.
                </p>
              </div>
            ) : (
              <div className="py-6 text-center">
                <p className="mb-2 text-base italic text-muted-foreground">The summary is being written.</p>
                {/* A held queue (no credit, bad key) says why it is waiting. */}
                {concern.ai_summary_error ? (
                  <p className="text-base text-amber-800">{concern.ai_summary_error}</p>
                ) : (
                  <p className="text-base text-muted-foreground">
                    It usually appears within a minute. Press &ldquo;Write a summary&rdquo; above to write it now.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Files the student attached when filing */}
      {attachments.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-base font-semibold">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            Attached files ({attachments.length})
          </h2>
          <ConcernAttachments attachments={attachments} />
        </section>
      )}

      {/* Response thread */}
      {responses.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">
            Replies ({responses.length})
          </h2>
          <div className="space-y-3">
            {responses.map((response) => {
              const fromStudent = response.responder_id === studentUserId;
              const author = fromStudent
                ? studentName
                : response.responder_id === user.id
                  ? "You"
                  : (staffNames.get(response.responder_id) ?? "OSA staff");
              return (
                <div
                  key={response.id}
                  className={cn(
                    "rounded-lg border p-4",
                    fromStudent ? "border-border bg-card" : "border-tup-maroon-200 bg-tup-maroon-50/30",
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <span className={cn("text-base font-semibold", fromStudent ? "text-foreground" : "text-tup-maroon-700")}>
                      {author}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">{fromStudent ? "Student" : "Staff"}</span>
                    </span>
                    <span className="text-sm text-muted-foreground">{formatManilaDateTime(response.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-base leading-relaxed">{response.response_text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Reply form; scroll-mt clears the sticky site header. */}
      <div id="reply" className="scroll-mt-20 rounded-lg border border-border bg-card p-4">
        <ResponseForm
          concernId={id}
          responderRole="staff"
          disabled={isClosed}
        />
      </div>

      {/* The rest of the queue, folded away: open it to move to the next concern. */}
      <details className="group rounded-lg border border-border bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-base font-medium [&::-webkit-details-marker]:hidden">
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          Other open concerns ({others.length})
          {urgentOthers > 0 && <span className="font-normal text-red-700">{urgentOthers} urgent</span>}
        </summary>
        {others.length === 0 ? (
          <p className="border-t border-border px-4 py-4 text-base text-muted-foreground">No other concerns are open.</p>
        ) : (
          <ul className="divide-y border-t border-border">
            {others.slice(0, QUEUE_SHOWN).map((q) => (
              <li key={q.id}>
                <Link
                  href={`/staff/concerns/${q.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/30"
                >
                  <UrgencyBadge level={q.urgency_level} />
                  <span className="min-w-0 flex-1 text-base font-medium">{q.subject_line}</span>
                  <span className="whitespace-nowrap text-sm text-muted-foreground">{timeAgo(q.created_at)}</span>
                </Link>
              </li>
            ))}
            {others.length > QUEUE_SHOWN && (
              <li className="px-4 py-3 text-base">
                <Link href="/staff/concerns" className="font-medium text-tup-maroon-700 hover:underline">
                  See all {others.length} on Student concerns
                </Link>
              </li>
            )}
          </ul>
        )}
      </details>
    </div>
  );
}

/** One label and value. Stacked in a grid, or on one line with `inline`. */
function Fact({ label, inline, children }: { label: string; inline?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn(inline && "flex flex-wrap items-baseline gap-x-2")}>
      <dt className="text-sm text-muted-foreground">{label}{inline ? ":" : ""}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
