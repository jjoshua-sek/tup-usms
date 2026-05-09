import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  MessageSquare,
  Building2,
  Calendar,
  Mail,
  Phone,
  IdCard,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { UrgencyBadge } from "@/components/concerns/urgency-badge";
import { StatusBadge } from "@/components/concerns/status-badge";
import { ResponseForm } from "@/components/concerns/response-form";
import { StatusUpdater } from "@/components/concerns/status-updater";
import { ConcernRealtime } from "@/components/concerns/concern-realtime";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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

interface ResponseEntry {
  id: string;
  responder_id: string;
  response_text: string;
  created_at: string;
}

interface ResponderInfo {
  id: string;
  name: string;
  isStaff: boolean;
}

function formatTimestamp(date: string): string {
  const d = new Date(date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

  // Fetch concern with full student info (RLS allows staff to see any)
  const { data: concernRaw } = await supabase
    .from("concerns")
    .select(
      `
      id,
      category,
      subject_line,
      body_text,
      ai_summary,
      urgency_level,
      suggested_dept,
      status,
      created_at,
      updated_at,
      assigned_to,
      students (
        id,
        first_name,
        last_name,
        student_number,
        email_address,
        cellphone,
        program,
        year_level,
        section
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  const concern = concernRaw as unknown as ConcernDetail | null;
  if (!concern) notFound();

  const student = concern.students;
  const studentName = student
    ? `${student.first_name} ${student.last_name}`
    : "Unknown student";

  // Look up assignee (if any)
  let assignedStaffName: string | null = null;
  if (concern.assigned_to) {
    const { data: assignedRaw } = await supabase
      .from("staff")
      .select("full_name")
      .eq("id", concern.assigned_to)
      .maybeSingle();
    const assigned = assignedRaw as { full_name: string } | null;
    assignedStaffName = assigned?.full_name ?? null;
  }

  // Fetch and resolve responses
  const { data: responsesRaw } = await supabase
    .from("concern_responses")
    .select("id, responder_id, response_text, created_at")
    .eq("concern_id", id)
    .order("created_at", { ascending: true });

  const responses = (responsesRaw as unknown as ResponseEntry[]) ?? [];

  const responderMap = new Map<string, ResponderInfo>();
  if (responses.length > 0) {
    const responderIds = Array.from(
      new Set(responses.map((r) => r.responder_id))
    );

    const { data: staffRaw } = await supabase
      .from("staff")
      .select("user_id, full_name")
      .in("user_id", responderIds);

    const staffEntries =
      (staffRaw as unknown as { user_id: string; full_name: string }[]) ?? [];
    for (const s of staffEntries) {
      responderMap.set(s.user_id, {
        id: s.user_id,
        name: s.full_name,
        isStaff: true,
      });
    }

    const remaining = responderIds.filter((rid) => !responderMap.has(rid));
    if (remaining.length > 0) {
      const { data: studentsRaw } = await supabase
        .from("students")
        .select("user_id, first_name, last_name")
        .in("user_id", remaining);

      const studentEntries =
        (studentsRaw as unknown as {
          user_id: string;
          first_name: string;
          last_name: string;
        }[]) ?? [];
      for (const s of studentEntries) {
        responderMap.set(s.user_id, {
          id: s.user_id,
          name: `${s.first_name} ${s.last_name}`,
          isStaff: false,
        });
      }
    }
  }

  const isClosed = concern.status === "closed";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Realtime: live updates when student replies or AI summary populates */}
      <ConcernRealtime concernId={id} />

      <Link
        href="/staff/concerns"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to queue
      </Link>

      {/* Header card */}
      <Card>
        <CardHeader className="space-y-4 border-b">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={concern.status} />
            <UrgencyBadge level={concern.urgency_level} />
            <Badge variant="secondary">{concern.category}</Badge>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-display font-bold tracking-tight text-balance">
                {concern.subject_line}
              </h1>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                Submitted {formatTimestamp(concern.created_at)}
                {concern.updated_at !== concern.created_at && (
                  <span> · Updated {formatTimestamp(concern.updated_at)}</span>
                )}
                {assignedStaffName && (
                  <span> · Assigned to {assignedStaffName}</span>
                )}
              </p>
            </div>
          </div>

          {/* Status controls */}
          <StatusUpdater
            concernId={id}
            currentStatus={concern.status}
            hasAiSummary={!!concern.ai_summary}
          />
        </CardHeader>

        <CardContent className="grid gap-6 lg:grid-cols-3 pt-6">
          {/* Main content: AI summary + body */}
          <div className="space-y-6 lg:col-span-2">
            {/* AI summary */}
            {concern.ai_summary ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      AI Summary
                    </p>
                    <p className="text-sm text-balance">{concern.ai_summary}</p>
                    {concern.suggested_dept && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                        <Building2 className="h-3 w-3" />
                        Suggested department:{" "}
                        <span className="font-medium text-foreground">
                          {concern.suggested_dept}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-4">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  No AI summary yet. Click &quot;Run AI&quot; above to analyze
                  this concern.
                </p>
              </div>
            )}

            {/* Full body */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Student&apos;s full submission
              </p>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {concern.body_text}
                </p>
              </div>
            </div>
          </div>

          {/* Sidebar: Student info */}
          <aside>
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Student
              </p>

              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-tup-maroon-900 text-white text-xs">
                    {getInitials(studentName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-display font-semibold leading-tight truncate">
                    {studentName}
                  </p>
                  {student && (
                    <p className="text-xs text-muted-foreground font-mono">
                      {student.student_number}
                    </p>
                  )}
                </div>
              </div>

              {student && (
                <>
                  <Separator />
                  <ul className="space-y-2 text-xs">
                    <li className="flex items-start gap-2">
                      <IdCard className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="text-muted-foreground">Program:</span>{" "}
                        <span className="font-medium">{student.program}</span>
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Calendar className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <span className="min-w-0">
                        <span className="text-muted-foreground">Year:</span>{" "}
                        <span className="font-medium">{student.year_level}</span>
                        {student.section && (
                          <>
                            {" "}
                            ·{" "}
                            <span className="text-muted-foreground">Section:</span>{" "}
                            <span className="font-medium">{student.section}</span>
                          </>
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                      <a
                        href={`mailto:${student.email_address}`}
                        className="text-primary hover:underline truncate min-w-0"
                      >
                        {student.email_address}
                      </a>
                    </li>
                    {student.cellphone && (
                      <li className="flex items-start gap-2">
                        <Phone className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <a
                          href={`tel:${student.cellphone}`}
                          className="text-primary hover:underline"
                        >
                          {student.cellphone}
                        </a>
                      </li>
                    )}
                  </ul>

                  <Separator />
                  <Link
                    href={`/staff/students/${student.id}`}
                    className="block text-xs text-primary hover:underline"
                  >
                    View full student profile →
                  </Link>
                </>
              )}
            </div>
          </aside>
        </CardContent>
      </Card>

      {/* Conversation thread */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Conversation
            {responses.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {responses.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {responses.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              No replies yet. Start the conversation by responding below.
            </p>
          ) : (
            <ul className="space-y-5">
              {responses.map((response) => {
                const responder = responderMap.get(response.responder_id);
                const name = responder?.name || "User";
                const isStaff = responder?.isStaff ?? false;
                const isMine = response.responder_id === user.id;

                return (
                  <li key={response.id} className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback
                        className={cn(
                          "text-xs",
                          isStaff
                            ? "bg-tup-maroon-900 text-white"
                            : "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {name}
                          {isMine && (
                            <span className="text-muted-foreground font-normal">
                              {" "}
                              (you)
                            </span>
                          )}
                        </span>
                        {isStaff && (
                          <Badge
                            variant="secondary"
                            className="h-5 text-[10px] bg-tup-maroon-900/10 text-tup-maroon-900 dark:bg-tup-maroon-400/10 dark:text-tup-maroon-300"
                          >
                            Staff
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(response.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                        {response.response_text}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Separator />

          <ResponseForm
            concernId={id}
            responderRole="staff"
            disabled={isClosed}
          />
        </CardContent>
      </Card>
    </div>
  );
}
