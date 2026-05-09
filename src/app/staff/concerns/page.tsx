import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Filter, Inbox, Sparkles } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONCERN_CATEGORIES,
  CONCERN_STATUSES,
  URGENCY_LEVELS as URGENCY_KEYS,
} from "@/lib/validations/concern";

export const metadata: Metadata = {
  title: "Concern Queue",
};

export const revalidate = 0;

interface ConcernRow {
  id: string;
  category: string;
  subject_line: string;
  ai_summary: string | null;
  urgency_level: string | null;
  suggested_dept: string | null;
  status: string;
  created_at: string;
  students: {
    first_name: string;
    last_name: string;
    student_number: string;
  } | null;
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

interface SearchParams {
  status?: string;
  urgency?: string;
  category?: string;
}

export default async function StaffConcernsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filterStatus = params.status || "all";
  const filterUrgency = params.urgency || "all";
  const filterCategory = params.category || "all";

  const supabase = await createClient();

  let query = supabase
    .from("concerns")
    .select(
      `
      id,
      category,
      subject_line,
      ai_summary,
      urgency_level,
      suggested_dept,
      status,
      created_at,
      students (
        first_name,
        last_name,
        student_number
      )
    `
    );

  if (filterStatus !== "all") query = query.eq("status", filterStatus);
  if (filterUrgency !== "all") query = query.eq("urgency_level", filterUrgency);
  if (filterCategory !== "all") query = query.eq("category", filterCategory);

  // Sort: critical first, then high, medium, low, then unprocessed
  query = query.order("urgency_level", { ascending: false, nullsFirst: false });
  query = query.order("created_at", { ascending: false });

  const { data: concernsRaw } = await query;
  const concerns = (concernsRaw as unknown as ConcernRow[]) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Concern Queue"
        description="All student concerns, sorted by AI-assessed urgency."
      />

      {/* Filter Bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
            {(filterStatus !== "all" ||
              filterUrgency !== "all" ||
              filterCategory !== "all") && (
              <Link
                href="/staff/concerns"
                className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </Link>
            )}
          </div>
          <CardDescription className="text-xs">
            {concerns.length} concern{concerns.length === 1 ? "" : "s"} matching
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterGroup
            label="Status"
            current={filterStatus}
            options={[
              { value: "all", label: "All" },
              ...(CONCERN_STATUSES as readonly string[]).map((s) => ({
                value: s,
                label: s.replace("_", " "),
              })),
            ]}
            paramKey="status"
            currentParams={params}
          />
          <FilterGroup
            label="Urgency"
            current={filterUrgency}
            options={[
              { value: "all", label: "All" },
              ...(URGENCY_KEYS as readonly string[]).map((u) => ({
                value: u,
                label: u,
              })),
            ]}
            paramKey="urgency"
            currentParams={params}
          />
          <FilterGroup
            label="Category"
            current={filterCategory}
            options={[
              { value: "all", label: "All" },
              ...CONCERN_CATEGORIES.map((c) => ({ value: c, label: c })),
            ]}
            paramKey="category"
            currentParams={params}
          />
        </CardContent>
      </Card>

      {/* Concern List */}
      {concerns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <Inbox className="h-8 w-8 text-emerald-600" />
            </div>
            <h3 className="mt-4 font-display font-semibold">
              No concerns match your filters
            </h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Try clearing some filters above, or check back later for new
              submissions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {concerns.map((concern) => {
              const studentName = concern.students
                ? `${concern.students.first_name} ${concern.students.last_name}`
                : "Unknown";
              const isProcessing = !concern.ai_summary;

              return (
                <li key={concern.id}>
                  <Link
                    href={`/staff/concerns/${concern.id}`}
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

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">{studentName}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="font-mono text-muted-foreground">
                          {concern.students?.student_number}
                        </span>
                        <StatusBadge status={concern.status} />
                        <UrgencyBadge level={concern.urgency_level} />
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          {concern.category}
                        </Badge>
                      </div>

                      {isProcessing ? (
                        <p className="flex items-center gap-1 text-xs italic text-muted-foreground/70">
                          <Sparkles className="h-3 w-3 animate-pulse" />
                          AI summary processing...
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {concern.ai_summary}
                        </p>
                      )}

                      {concern.suggested_dept && (
                        <p className="text-xs">
                          <span className="text-muted-foreground">
                            Suggested:
                          </span>{" "}
                          <span className="font-medium">
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

// ============================================================
// Filter pills — server-side rendered, link-based.
// ============================================================
interface FilterGroupProps {
  label: string;
  current: string;
  options: { value: string; label: string }[];
  paramKey: keyof SearchParams;
  currentParams: SearchParams;
}

function FilterGroup({
  label,
  current,
  options,
  paramKey,
  currentParams,
}: FilterGroupProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const newParams = new URLSearchParams();
          for (const [k, v] of Object.entries(currentParams)) {
            if (v && v !== "all" && k !== paramKey) {
              newParams.set(k, v);
            }
          }
          if (opt.value !== "all") {
            newParams.set(paramKey, opt.value);
          }
          const href =
            newParams.toString().length > 0
              ? `/staff/concerns?${newParams.toString()}`
              : "/staff/concerns";

          const isActive = current === opt.value;
          return (
            <Link
              key={opt.value}
              href={href}
              className={cn(
                buttonVariants({
                  variant: isActive ? "default" : "outline",
                  size: "sm",
                }),
                "h-7 capitalize"
              )}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
