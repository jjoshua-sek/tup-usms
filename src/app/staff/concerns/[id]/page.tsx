import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Zap,
  Flag,
  Building2,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { ResponseForm } from "@/components/concerns/response-form";
import { StatusUpdater } from "@/components/concerns/status-updater";
import { ConcernRealtime } from "@/components/concerns/concern-realtime";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

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
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    email_address: string;
    cellphone: string | null;
    program: string;
    year_level: string;
    section: string | null;
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

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(date: string): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortId(id: string): string {
  // Convert UUID to mockup-style ID: #C-2026-0148
  // For demo purposes, take last 4 chars and prefix
  const tail = id.replace(/-/g, "").slice(-4).toUpperCase();
  return `#C-${new Date().getFullYear()}-${tail}`;
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
    .select(
      `
      id, category, subject_line, body_text, ai_summary, urgency_level,
      suggested_dept, status, created_at, updated_at, assigned_to,
      students (
        id, first_name, last_name, student_number, email_address,
        cellphone, program, year_level, section
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  const concern = concernRaw as unknown as ConcernDetail | null;
  if (!concern) notFound();

  // Fetch queue (sibling concerns) — pending + in_review, newest first
  const { data: queueRaw } = await supabase
    .from("concerns")
    .select("id, subject_line, urgency_level, status, created_at")
    .in("status", ["pending", "in_review"])
    .order("urgency_level", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);
  const queue = (queueRaw as unknown as QueueRow[]) ?? [];

  // Fetch responses
  const { data: responsesRaw } = await supabase
    .from("concern_responses")
    .select("id, responder_id, response_text, created_at")
    .eq("concern_id", id)
    .order("created_at", { ascending: true });
  const responses = (responsesRaw as unknown as ResponseEntry[]) ?? [];

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
          { label: "Console", href: "/staff/dashboard" },
          { label: "Concerns", href: "/staff/concerns" },
          { label: "Queue", href: "/staff/concerns" },
          { label: shortId(id) },
        ]}
        title="Concern Review"
      >
        <span className="text-[11px] text-muted-foreground font-mono mr-2">
          {totalQueue} in queue · {highUrgencyCount} high urgency
        </span>
        <Link
          href="/staff/concerns"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
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
            <h4 className="text-[13px] font-semibold">Queue</h4>
            <span className="font-mono text-[10px] text-muted-foreground bg-card px-2 py-1 rounded-full border border-border">
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
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {shortId(q.id)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(q.created_at)}
                    </span>
                  </div>
                  <div className="text-[12px] font-medium leading-tight mb-1.5 line-clamp-2">
                    {q.subject_line}
                  </div>
                  {q.urgency_level && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
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
              <p className="text-xs text-muted-foreground text-center py-4">
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
              <div className="font-mono text-[11px] text-muted-foreground mb-1">
                {shortId(concern.id)} · Submitted {formatTimestamp(concern.created_at)}
              </div>
              <h2 className="text-[18px] font-semibold tracking-tight mb-2 text-balance">
                {concern.subject_line}
              </h2>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground font-medium">
                    {studentName}
                  </strong>
                  {student && ` · ${student.program} ${student.year_level}`}
                </span>
                <span>
                  Category:{" "}
                  <strong className="text-foreground font-medium">
                    {concern.category}
                  </strong>
                </span>
                <span className="flex items-center gap-1">
                  Status:{" "}
                  <StatusUpdater
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
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
              >
                View student profile →
              </Link>
            )}
          </div>

          {/* Side-by-side concern panels */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* ORIGINAL SUBMISSION PANEL */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className="bg-accent border-b border-border px-3.5 py-2.5 flex justify-between items-center">
                <span className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  📝 Original Submission
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {words} words
                </span>
              </div>
              <div className="p-4">
                <p className="text-[13px] leading-[1.65] italic text-balance">
                  &ldquo;{concern.body_text}&rdquo;
                </p>
                <span className="inline-block mt-3 not-italic font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  Detected: {lang.label}
                </span>
              </div>
            </div>

            {/* AI SUMMARY PANEL */}
            <div className="border border-ai-accent rounded-md overflow-hidden">
              <div className="bg-ai-accent-soft border-b border-ai-accent px-3.5 py-2.5 flex justify-between items-center">
                <span className="font-mono text-[11px] font-semibold text-ai-accent uppercase tracking-wider flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  AI-Generated Summary
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ai-accent-soft text-ai-accent border border-ai-accent">
                  Claude Sonnet 4
                </span>
              </div>
              <div className="p-4">
                {concern.ai_summary ? (
                  <>
                    <p className="text-[13px] leading-relaxed mb-4">
                      {concern.ai_summary}
                    </p>
                    <div className="border-t border-border pt-3.5 space-y-0">
                      <AiField label="urgency_level">
                        {concern.urgency_level && (
                          <span
                            className={cn(
                              "inline-flex items-center font-mono text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
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
                          <span className="text-[12px] font-medium flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {concern.suggested_dept}
                          </span>
                        </AiField>
                      )}
                      <AiField label="detected_language">
                        <span className="text-[12px] font-medium">
                          {lang.label}
                        </span>
                      </AiField>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3.5 pt-3 border-t border-ai-accent text-[10px] text-ai-accent font-mono">
                      <Zap className="h-3 w-3" />
                      Generated · Reviewable · See audit log
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-[13px] text-muted-foreground italic mb-2">
                      AI analysis pending...
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      The summary will appear here when the AI completes
                      processing. Use the &ldquo;Re-analyze&rdquo; button in
                      the status row to manually trigger it.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 pt-5 border-t border-border">
            <button
              type="button"
              className="px-3 py-2 rounded-md text-xs font-medium bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 transition-colors"
            >
              Respond to Student
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
            >
              Reassign Department
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
            >
              Mark Resolved
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-md text-xs font-medium bg-card border border-[#fde68a] text-[#92400e] hover:bg-[#fef3c7] transition-colors inline-flex items-center justify-center gap-1"
            >
              <Flag className="h-3.5 w-3.5" />
              Flag
            </button>
          </div>

          {/* Response thread */}
          {responses.length > 0 && (
            <div className="mb-6 border-t border-border pt-5">
              <h3 className="text-[13px] font-semibold mb-3">
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
                            "font-mono text-[10px] font-semibold uppercase tracking-wider",
                            isStaff ? "text-tup-maroon-600" : "text-muted-foreground"
                          )}
                        >
                          {isStaff ? "Staff" : "Student"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTimestamp(response.created_at)}
                        </span>
                      </div>
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed">
                        {response.response_text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Reply form */}
          <div className="border-t border-border pt-5">
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
    <div className="flex justify-between items-center py-1.5 text-[12px]">
      <span className="text-muted-foreground font-mono text-[11px]">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
