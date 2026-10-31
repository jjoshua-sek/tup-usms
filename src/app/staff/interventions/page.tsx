import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, HeartbeatIcon as HeartPulse } from "@phosphor-icons/react/ssr";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { InterventionStatusForm } from "@/components/risk/intervention-form";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getStaffContext } from "@/lib/osa/staff-context";
import {
  FOLLOW_UP_FINISHED,
  FOLLOW_UP_OUTCOME_LABELS,
  followUpStatusLabel,
  followUpTypeLabel,
} from "@/lib/risk/follow-up-labels";
import { RISK_TIER_META } from "@/lib/risk/score";
import type { RiskTier } from "@/lib/risk/types";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManilaDate } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Follow-ups",
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

/** How many finished follow-ups the folded list shows. */
const FINISHED_SHOWN = 30;

const COLUMNS =
  "id, intervention_type, rationale, status, priority, scheduled_for, outcome, outcome_rating, created_at, completed_at, students(id, first_name, last_name, student_number, program), risk_assessments(risk_tier, risk_score)";

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

/**
 * The follow-through half of the early warning system.
 *
 * A flagged student who is never contacted is worse than no flag at all, so
 * this queue exists to make the gap visible: everything not started yet is a
 * student the model surfaced and nobody has reached yet. It comes first.
 */
export default async function StaffInterventionsPage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCounselor)) {
    return (
      <RestrictedNotice
        title="Follow-ups"
        audience="Follow-ups are managed by OSA officers and guidance counselors."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);
  const finishedList = `(${FOLLOW_UP_FINISHED.join(",")})`;

  // Two reads, so open follow-ups never lose rows to a cap filled by old
  // ones: every open one, then the most recently finished.
  const [{ data: openRows }, { data: finishedRows }] = await Promise.all([
    db
      .from("risk_interventions")
      .select(COLUMNS)
      .not("status", "in", finishedList)
      .order("created_at", { ascending: true })
      .limit(300),
    db
      .from("risk_interventions")
      .select(COLUMNS)
      .in("status", [...FOLLOW_UP_FINISHED])
      .order("created_at", { ascending: false })
      .limit(FINISHED_SHOWN),
  ]);

  const open = (openRows as InterventionRow[] | null) ?? [];
  const finished = (finishedRows as InterventionRow[] | null) ?? [];
  const notStarted = open.filter((item) => item.status === "recommended");
  const underway = open.filter((item) => item.status !== "recommended");

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Follow-ups" }]}
        title="Follow-ups"
        description="Help offered to students on the at-risk list, and what came of it. Start one from a student on At-risk students."
      >
        <Link href="/staff/risk" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to At-risk students
        </Link>
      </PageHeader>

      {open.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title="No follow-ups open"
          description="Start one from At-risk students. The score that justified it is kept with the record."
        />
      ) : (
        <>
          {notStarted.length > 0 && (
            <Group
              title="Not started yet"
              note="A student was flagged and nobody has reached out. Set the status once someone does."
              items={notStarted}
            />
          )}
          {underway.length > 0 && (
            <Group
              title="Under way"
              note="Record how it went and mark it Done when it is finished."
              items={underway}
            />
          )}
        </>
      )}

      {finished.length > 0 && (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            Finished
            <span className="font-normal text-muted-foreground">
              ({finished.length === FINISHED_SHOWN ? `the last ${FINISHED_SHOWN}` : finished.length}, done, declined or cancelled)
            </span>
          </summary>
          <ul className="space-y-3 border-t border-border p-4">
            {finished.map((item) => (
              <FollowUpItem key={item.id} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({ title, note, items }: { title: string; note: string; items: InterventionRow[] }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </h2>
      <p className="mb-3 mt-0.5 text-base text-muted-foreground">{note}</p>
      <ul className="space-y-3">
        {items.map((item) => (
          <FollowUpItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function FollowUpItem({ item }: { item: InterventionRow }) {
  const assessment = item.risk_assessments;
  const tier = assessment ? RISK_TIER_META[assessment.risk_tier as RiskTier] : null;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-base">
          {item.students ? (
            <Link
              href={`/staff/students/${item.students.id}`}
              className="text-lg font-semibold text-tup-maroon-700 underline-offset-2 hover:underline"
            >
              {item.students.first_name} {item.students.last_name}
            </Link>
          ) : (
            <span className="text-lg font-semibold">Unknown student</span>
          )}
          {item.students?.student_number && (
            <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
              {item.students.student_number}
            </span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium">{followUpTypeLabel(item.intervention_type)}</span>
          <ToneBadge label={followUpStatusLabel(item.status)} tone={STATUS_TONE[item.status] ?? "neutral"} />
          {item.priority !== "normal" && (
            <ToneBadge
              label={`${item.priority.charAt(0).toUpperCase()}${item.priority.slice(1)} priority`}
              tone={PRIORITY_TONE[item.priority] ?? "neutral"}
            />
          )}
        </p>

        {item.rationale && <p className="max-w-prose text-base text-muted-foreground">{item.rationale}</p>}

        <p className="text-sm text-muted-foreground">
          Started {formatManilaDate(item.created_at)}
          {assessment && tier
            ? ` · Rated ${tier.label.toLowerCase()} (${Math.round(Number(assessment.risk_score) * 100)}%) at the time`
            : ""}
          {item.completed_at ? ` · Finished ${formatManilaDate(item.completed_at)}` : ""}
        </p>

        {item.outcome && (
          <p className="mt-2 rounded-md bg-muted p-2 text-base">
            <strong>What happened:</strong> {item.outcome}
            {item.outcome_rating ? ` (${FOLLOW_UP_OUTCOME_LABELS[item.outcome_rating] ?? item.outcome_rating})` : ""}
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <InterventionStatusForm interventionId={item.id} currentStatus={item.status} />
      </div>
    </li>
  );
}
