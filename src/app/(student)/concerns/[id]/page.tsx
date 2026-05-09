import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  MessageSquare,
  Building2,
  Calendar,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { UrgencyBadge } from "@/components/concerns/urgency-badge";
import { StatusBadge } from "@/components/concerns/status-badge";
import { ResponseForm } from "@/components/concerns/response-form";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Concern Detail",
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
  students: {
    first_name: string;
    last_name: string;
    student_number: string;
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

export default async function ConcernDetailPage({
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

  // Fetch concern with student info (RLS auto-restricts to owner or staff)
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
      students (
        first_name,
        last_name,
        student_number
      )
    `
    )
    .eq("id", id)
    .maybeSingle();

  const concern = concernRaw as unknown as ConcernDetail | null;
  if (!concern) notFound();

  // Fetch responses + responder info
  const { data: responsesRaw } = await supabase
    .from("concern_responses")
    .select("id, responder_id, response_text, created_at")
    .eq("concern_id", id)
    .order("created_at", { ascending: true });

  const responses = (responsesRaw as unknown as ResponseEntry[]) ?? [];

  // Look up responder names (in parallel)
  const responderMap = new Map<string, ResponderInfo>();
  if (responses.length > 0) {
    const responderIds = Array.from(
      new Set(responses.map((r) => r.responder_id))
    );

    // Try staff first
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

    // Then students for any unmatched IDs
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
  const studentName = concern.students
    ? `${concern.students.first_name} ${concern.students.last_name}`
    : "You";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Realtime: refreshes when new responses arrive or AI summary updates */}
      <ConcernRealtime concernId={id} />

      {/* Back link */}
      <Link
        href="/concerns"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to my concerns
      </Link>

      {/* Header card */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={concern.status} />
            <UrgencyBadge level={concern.urgency_level} />
            <Badge variant="secondary">{concern.category}</Badge>
          </div>

          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-balance">
              {concern.subject_line}
            </h1>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Submitted {formatTimestamp(concern.created_at)}
              {concern.updated_at !== concern.created_at && (
                <span> · Updated {formatTimestamp(concern.updated_at)}</span>
              )}
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* AI summary panel — visually distinct */}
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
                      Routed to:{" "}
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
                <Sparkles className="h-4 w-4 animate-pulse" />
                AI is still analyzing your concern. The summary should appear
                in a few seconds — refresh to check.
              </p>
            </div>
          )}

          {/* Full body */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Your full concern
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {concern.body_text}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Response thread */}
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
              No replies yet. Staff will respond here once they review your
              concern.
            </p>
          ) : (
            <ul className="space-y-5">
              {responses.map((response) => {
                const responder = responderMap.get(response.responder_id);
                const name =
                  responder?.name ||
                  (response.responder_id === user.id ? studentName : "User");
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
            responderRole="student"
            disabled={isClosed}
          />
        </CardContent>
      </Card>
    </div>
  );
}
