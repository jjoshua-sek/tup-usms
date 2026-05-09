import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Plus,
  Sparkles,
  ChevronRight,
  Inbox,
  ArrowRight,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { ConcernForm } from "@/components/concerns/concern-form";
import { UrgencyBadge, UrgencyBar } from "@/components/concerns/urgency-badge";
import { StatusBadge } from "@/components/concerns/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "My Concerns",
};

// Don't cache — students want to see new submissions instantly
export const revalidate = 0;

interface ConcernRow {
  id: string;
  category: string;
  subject_line: string;
  body_text: string;
  ai_summary: string | null;
  urgency_level: string | null;
  suggested_dept: string | null;
  status: string;
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
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default async function ConcernsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find student id (RLS will already restrict to current user)
  const { data: studentRaw } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as { id: string } | null;

  // If no profile yet, gently nudge them to set one up
  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Concerns"
          description="Submit issues and questions to TUP-Manila staff."
        />
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Profile required</CardTitle>
            <CardDescription>
              You need to complete your student profile before submitting
              concerns. This helps staff identify and route your concern correctly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/profile"
              className={buttonVariants({ variant: "default" })}
            >
              Complete profile
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch student's concerns (RLS auto-filters to this student)
  const { data: concernsRaw } = await supabase
    .from("concerns")
    .select(
      "id, category, subject_line, body_text, ai_summary, urgency_level, suggested_dept, status, created_at"
    )
    .eq("student_id", student.id)
    .order("created_at", { ascending: false });

  const concerns = (concernsRaw as unknown as ConcernRow[]) ?? [];

  // Group counts by status for the summary strip
  const counts = {
    total: concerns.length,
    pending: concerns.filter((c) => c.status === "pending").length,
    inReview: concerns.filter((c) => c.status === "in_review").length,
    resolved: concerns.filter((c) => c.status === "resolved").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Concerns"
        description="Submit issues, questions, or feedback. Our AI will help route them."
      >
        <ConcernForm
          trigger={
            <Button className="bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white">
              <Plus className="mr-1 h-4 w-4" />
              New Concern
            </Button>
          }
        />
      </PageHeader>

      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="All concerns" value={counts.total} />
        <SummaryStat label="Pending" value={counts.pending} accent="amber" />
        <SummaryStat label="In review" value={counts.inReview} accent="violet" />
        <SummaryStat label="Resolved" value={counts.resolved} accent="emerald" />
      </div>

      {/* Concerns list */}
      {concerns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Inbox className="h-8 w-8 text-primary" />
            </div>
            <h3 className="mt-4 font-display font-semibold">No concerns yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              When you have an issue or question for TUP staff, submit it here.
              Our AI will help summarize and route it to the right department.
            </p>
            <ConcernForm
              trigger={
                <Button className="mt-6 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white">
                  <Sparkles className="mr-1 h-4 w-4" />
                  Submit your first concern
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {concerns.map((concern) => {
              const isProcessing = !concern.ai_summary;
              return (
                <li key={concern.id}>
                  <Link
                    href={`/concerns/${concern.id}`}
                    className="flex items-stretch gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
                  >
                    <UrgencyBar level={concern.urgency_level} />

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-display font-semibold leading-tight text-balance">
                          {concern.subject_line}
                        </p>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(concern.created_at)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={concern.status} />
                        <UrgencyBadge level={concern.urgency_level} />
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          {concern.category}
                        </Badge>
                      </div>

                      {isProcessing ? (
                        <p className="flex items-center gap-1.5 text-xs italic text-muted-foreground/70">
                          <Sparkles className="h-3 w-3 animate-pulse" />
                          AI is analyzing your concern...
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          <span className="font-medium text-foreground/80">
                            AI summary:
                          </span>{" "}
                          {concern.ai_summary}
                        </p>
                      )}

                      {concern.suggested_dept && (
                        <p className="text-xs text-muted-foreground">
                          Routed to:{" "}
                          <span className="font-medium text-foreground">
                            {concern.suggested_dept}
                          </span>
                        </p>
                      )}
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 self-center" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface SummaryStatProps {
  label: string;
  value: number;
  accent?: "amber" | "violet" | "emerald";
}

function SummaryStat({ label, value, accent }: SummaryStatProps) {
  const accentClass = {
    amber: "text-amber-600 dark:text-amber-400",
    violet: "text-violet-600 dark:text-violet-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  };
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 font-display text-2xl font-bold tabular-nums",
            accent && accentClass[accent]
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
