import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, CaretRightIcon as ChevronRight, TrayIcon as Inbox, PlusIcon as Plus, SparkleIcon as Sparkles } from "@phosphor-icons/react/ssr";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { UrgencyBadge, UrgencyBar, URGENCY_LEVELS } from "@/components/concerns/urgency-badge";
import { CONCERN_STATUSES as STATUS_LABELS, StatusBadge } from "@/components/concerns/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/time";
import { RECEIVED_VIA_LABEL, receivedVia } from "@/lib/concerns/intake";
import { byUrgencyThenNewest } from "@/lib/concerns/queue-order";
import {
  CONCERN_CATEGORIES,
  CONCERN_STATUSES,
  URGENCY_LEVELS as URGENCY_KEYS,
  concernCategoryLabel,
} from "@/lib/validations/concern";

export const metadata: Metadata = {
  title: "Student concerns",
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
  /** Migration 00023; absent until it runs. */
  ai_summary_status?: "pending" | "done" | "failed";
  /** Migration 00036; absent until it runs. */
  received_via?: string;
  referred_by?: string | null;
  students: {
    first_name: string;
    last_name: string;
    student_number: string;
  } | null;
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
  const anyFilter = filterStatus !== "all" || filterUrgency !== "all" || filterCategory !== "all";
  // Urgency and category sit folded under "More filters" unless one is in use.
  const moreFiltersInUse = filterUrgency !== "all" || filterCategory !== "all";

  const supabase = await createClient();

  let query = supabase
    .from("concerns")
    // "*" so ai_summary_status is included once migration 00023 exists,
    // without naming a column that would fail the query before it does.
    .select(
      `
      *,
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

  const { data: concernsRaw } = await query;
  // Most urgent first (sorted here: see queue-order.ts).
  const concerns = ((concernsRaw as unknown as ConcernRow[]) ?? []).sort(byUrgencyThenNewest);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student concerns"
        description="Concerns sent in by students or recorded by the OSA. The most urgent are at the top."
      >
        <Link
          href="/staff/concerns/new"
          className={cn(buttonVariants(), "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700")}
        >
          <Plus className="mr-1 h-4 w-4" /> Record a concern
        </Link>
      </PageHeader>

      {/* Filters: status always shown, the rest folded away. */}
      <div className="space-y-3">
        <FilterGroup
          label="Show"
          current={filterStatus}
          options={[
            { value: "all", label: "All" },
            ...CONCERN_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s].label })),
          ]}
          paramKey="status"
          currentParams={params}
        />

        <details open={moreFiltersInUse} className="group rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            More filters
            <span className="text-muted-foreground font-normal">(urgency and category)</span>
          </summary>
          <div className="space-y-4 border-t border-border px-4 py-4">
            <FilterGroup
              label="Urgency"
              current={filterUrgency}
              options={[
                { value: "all", label: "All" },
                ...URGENCY_KEYS.map((u) => ({ value: u, label: URGENCY_LEVELS[u].label })),
              ]}
              paramKey="urgency"
              currentParams={params}
            />
            <FilterGroup
              label="Category"
              current={filterCategory}
              options={[
                { value: "all", label: "All" },
                ...CONCERN_CATEGORIES.map((c) => ({ value: c, label: concernCategoryLabel(c) })),
              ]}
              paramKey="category"
              currentParams={params}
            />
          </div>
        </details>

        <div className="flex items-center gap-3 text-base">
          <p className="text-muted-foreground">
            {concerns.length} {concerns.length === 1 ? "concern" : "concerns"}
            {anyFilter ? " match these filters" : ""}
          </p>
          {anyFilter && (
            <Link href="/staff/concerns" className="font-medium text-tup-maroon-700 hover:underline">
              Clear filters
            </Link>
          )}
        </div>
      </div>

      {/* Concern List */}
      {concerns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <Inbox className="h-8 w-8 text-emerald-600" />
            </div>
            <h3 className="mt-4 font-display font-semibold">
              {anyFilter ? "No concerns match these filters" : "No concerns yet"}
            </h3>
            <p className="mt-1 max-w-sm text-base text-muted-foreground">
              {anyFilter
                ? "Press Clear filters above to see every concern."
                : "New concerns from students appear here as soon as they are sent."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <ul className="divide-y">
            {concerns.map((concern) => {
              const studentName = concern.students
                ? `${concern.students.first_name} ${concern.students.last_name}`
                : "Unknown student";
              const summaryFailed = concern.ai_summary_status === "failed";
              const isProcessing = !concern.ai_summary && !summaryFailed;
              const via = receivedVia(concern.received_via);

              return (
                <li key={concern.id}>
                  <Link
                    href={`/staff/concerns/${concern.id}`}
                    className="flex items-stretch gap-4 px-5 py-4 transition-colors hover:bg-accent/30 focus-visible:bg-accent/40 focus-visible:outline-none"
                  >
                    <UrgencyBar level={concern.urgency_level} />

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-lg font-semibold leading-snug text-balance">
                          {concern.subject_line}
                        </p>
                        <span className="text-sm text-muted-foreground whitespace-nowrap pt-1">
                          {timeAgo(concern.created_at)}
                        </span>
                      </div>

                      <p className="text-base">
                        <span className="font-medium">{studentName}</span>
                        {concern.students?.student_number && (
                          <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
                            {concern.students.student_number}
                          </span>
                        )}
                        <span className="text-muted-foreground"> · {concernCategoryLabel(concern.category)}</span>
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <UrgencyBadge level={concern.urgency_level} />
                        <StatusBadge status={concern.status} />
                        {via !== "online" && (
                          <Badge variant="outline">
                            {RECEIVED_VIA_LABEL[via]}
                            {concern.referred_by ? `: ${concern.referred_by}` : ""}
                          </Badge>
                        )}
                      </div>

                      {isProcessing ? (
                        <p className="flex items-center gap-1.5 text-base italic text-muted-foreground">
                          <Sparkles className="h-4 w-4 animate-pulse" />
                          The summary is being written.
                        </p>
                      ) : summaryFailed ? (
                        <p className="text-base text-amber-800">
                          No summary yet. Open the concern to read it in full, or run the summary again.
                        </p>
                      ) : (
                        <p className="text-base text-muted-foreground line-clamp-2">
                          {concern.ai_summary}
                        </p>
                      )}

                      {concern.suggested_dept && (
                        <p className="text-base">
                          <span className="text-muted-foreground">Suggested office:</span>{" "}
                          <span className="font-medium">{concern.suggested_dept}</span>
                        </p>
                      )}
                    </div>

                    <ChevronRight className="h-5 w-5 text-muted-foreground/60 self-center" aria-hidden="true" />
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
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-1 text-base font-medium text-muted-foreground">{label}:</p>
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
            aria-current={isActive ? "true" : undefined}
            className={cn(
              buttonVariants({ variant: isActive ? "default" : "outline", size: "sm" }),
              isActive && "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700",
            )}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
