import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, HeartPulse, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { InterventionStatusForm } from "@/components/risk/intervention-form";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Interventions",
};

export const revalidate = 20;

const STATUS_TONE: Record<string, Tone> = {
  recommended: "warning",
  approved: "info",
  scheduled: "info",
  in_progress: "info",
  completed: "success",
  declined: "neutral",
  cancelled: "neutral",
};

const PRIORITY_TONE: Record<string, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

interface InterventionRow {
  id: string;
  intervention_type: string;
  rationale: string | null;
  status: string;
  priority: string;
  scheduled_for: string | null;
  outcome: string | null;
  outcome_rating: string | null;
  created_at: string;
  completed_at: string | null;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
  } | null;
  risk_assessments: { risk_tier: string; risk_score: number } | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The follow-through half of the early warning system.
 *
 * A flagged student who is never contacted is worse than no flag at all, so
 * this queue exists to make the gap visible: everything sitting in
 * "recommended" is a student the model surfaced and nobody has reached yet.
 */
export default async function StaffInterventionsPage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCounselor)) {
    return (
      <RestrictedNotice
        title="Interventions"
        audience="Interventions are managed by OSA officers and guidance counselors."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("risk_interventions")
    .select(
      "id, intervention_type, rationale, status, priority, scheduled_for, outcome, outcome_rating, created_at, completed_at, students(id, first_name, last_name, student_number, program), risk_assessments(risk_tier, risk_score)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const interventions = (rows as InterventionRow[] | null) ?? [];

  const openItems = interventions.filter(
    (item) => !["completed", "declined", "cancelled"].includes(item.status),
  );
  const untouched = interventions.filter((item) => item.status === "recommended");
  const completed = interventions.filter((item) => item.status === "completed");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Interventions" }]}
        title="Interventions"
        description="Outreach opened from the early warning list, and what came of it."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard
          label="Not yet actioned"
          value={untouched.length}
          icon={HeartPulse}
          iconTone={untouched.length > 0 ? "warn" : "neutral"}
          trend="Flagged but nobody has reached out"
          trendTone={untouched.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard label="In progress" value={openItems.length} icon={ListChecks} />
        <StatsCard
          label="Completed"
          value={completed.length}
          icon={CheckCircle2}
          iconTone="success"
        />
      </div>

      {interventions.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title="No interventions yet"
          description="Open one from the At-Risk list. The assessment that justified it is stored with the record."
        />
      ) : (
        <ul className="space-y-3">
          {interventions.map((item) => (
            <li key={item.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[15px] font-semibold capitalize">
                      {item.intervention_type.replace(/_/g, " ")}
                    </p>
                    <ToneBadge
                      label={item.status.replace(/_/g, " ")}
                      tone={STATUS_TONE[item.status] ?? "neutral"}
                    />
                    {item.priority !== "normal" && (
                      <ToneBadge
                        label={item.priority}
                        tone={PRIORITY_TONE[item.priority] ?? "neutral"}
                      />
                    )}
                    {item.risk_assessments && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {item.risk_assessments.risk_tier} ·{" "}
                        {Math.round(Number(item.risk_assessments.risk_score) * 100)}%
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-[13px]">
                    {item.students ? (
                      <Link
                        href={`/staff/students/${item.students.id}`}
                        className="text-tup-maroon-600 underline-offset-2 hover:underline"
                      >
                        {item.students.first_name} {item.students.last_name}
                      </Link>
                    ) : (
                      "Unknown student"
                    )}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {item.students?.student_number}
                    </span>
                  </p>

                  {item.rationale && (
                    <p className="mt-1 text-[12px] text-muted-foreground">{item.rationale}</p>
                  )}

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Opened {formatDate(item.created_at)}
                    {item.completed_at ? ` · closed ${formatDate(item.completed_at)}` : ""}
                  </p>

                  {item.outcome && (
                    <p className="mt-2 rounded-md bg-muted p-2 text-[12px]">
                      <strong>Outcome:</strong> {item.outcome}
                      {item.outcome_rating ? ` (${item.outcome_rating.replace(/_/g, " ")})` : ""}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <InterventionStatusForm
                  interventionId={item.id}
                  currentStatus={item.status}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
