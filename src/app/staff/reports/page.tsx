import type { Metadata } from "next";
import { MedalIcon as Award, ClipboardTextIcon as ClipboardCheck, DoorOpenIcon as DoorOpen, DownloadSimpleIcon as Download, GavelIcon as Gavel, IdentificationCardIcon as IdCard, ScalesIcon as Scale, TrendUpIcon as TrendingUp, UsersIcon as Users } from "@phosphor-icons/react/ssr";

import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getCurrentTerm } from "@/lib/access/term";
import { buildCollegeReport, totalRow } from "@/lib/osa/college-report";
import { loadCollegeReportInput } from "@/lib/osa/college-report-data";
import { getStaffContext } from "@/lib/osa/staff-context";
import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { scoreStudent } from "@/lib/risk/score";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CASE_STATUS_META, type CaseStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "Reports",
};

export const revalidate = 60;

/**
 * Term-level figures for the OSA's own reporting.
 *
 * Counts only — no names. A report that lists individuals gets forwarded
 * around campus; a report of totals answers the question ("how is the term
 * going?") without turning into a second, uncontrolled copy of the record.
 */
export default async function StaffReportsPage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && staff.role !== "osa_head")) {
    return (
      <RestrictedNotice
        title="Reports"
        audience="Reporting is available to OSA officers and the OSA head."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);
  const term = getCurrentTerm();

  const termStart = new Date();
  termStart.setMonth(termStart.getMonth() - 5);
  const termStartIso = termStart.toISOString();

  const [
    { data: caseRows },
    { count: hearingCount },
    { count: studentCount },
    { count: clearanceOpen },
    { count: clearanceIssued },
    { count: validatedIds },
    { count: accessAllowed },
    { count: accessDenied },
    { count: openAnomalies },
    { count: scholarshipQueue },
    model,
    features,
  ] = await Promise.all([
    db.from("violation_cases").select("classification, status, created_at").limit(2000),
    db
      .from("case_hearings")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_start", termStartIso),
    db.from("students").select("id", { count: "exact", head: true }),
    db
      .from("clearance_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "verifying", "on_hold"]),
    db
      .from("clearance_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "issued"),
    db
      .from("id_validations")
      .select("id", { count: "exact", head: true })
      .eq("status", "validated")
      .eq("school_year", term.schoolYear)
      .eq("semester", term.semester),
    db
      .from("access_events")
      .select("id", { count: "exact", head: true })
      .eq("decision", "allow")
      .gte("occurred_at", termStartIso),
    db
      .from("access_events")
      .select("id", { count: "exact", head: true })
      .eq("decision", "deny")
      .gte("occurred_at", termStartIso),
    db
      .from("access_anomalies")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    db
      .from("scholarship_applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["interest_declared", "documents_pending", "under_review"]),
    loadActiveRiskModel(db),
    loadRiskFeatures(db, { limit: 500 }),
  ]);

  const collegeRows = buildCollegeReport(await loadCollegeReportInput(db, term, termStartIso));

  const cases =
    (caseRows as Array<{ classification: string; status: CaseStatus; created_at: string }> | null) ??
    [];

  const openCases = cases.filter((row) => !CASE_STATUS_META[row.status]?.isTerminal);
  const minor = cases.filter((row) => row.classification === "minor").length;
  const major = cases.filter((row) => row.classification === "major").length;
  const thisTerm = cases.filter((row) => row.created_at >= termStartIso).length;

  const tiers = { low: 0, moderate: 0, high: 0, critical: 0 };
  if (model) {
    for (const row of features) {
      tiers[scoreStudent(featuresToInputs(row), model).risk_tier] += 1;
    }
  }

  const byStatus = new Map<CaseStatus, number>();
  for (const row of cases) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Reports" }]}
        title="Reports"
        description={`Totals for ${term.label}. Figures only — open the individual queues for names.`}
      />

      <Section title="Discipline">
        <StatsCard label="Cases filed (term)" value={thisTerm} icon={Scale} />
        <StatsCard
          label="Open cases"
          value={openCases.length}
          icon={Gavel}
          iconTone={openCases.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard label="Minor / major (all time)" value={`${minor} / ${major}`} icon={Scale} />
        <StatsCard label="Hearings scheduled" value={hearingCount ?? 0} icon={Gavel} />
      </Section>

      <Section title="Early warning">
        <StatsCard
          label="Critical"
          value={tiers.critical}
          icon={TrendingUp}
          iconTone={tiers.critical > 0 ? "danger" : "neutral"}
        />
        <StatsCard label="High" value={tiers.high} icon={TrendingUp} iconTone={tiers.high > 0 ? "warn" : "neutral"} />
        <StatsCard label="Moderate" value={tiers.moderate} icon={TrendingUp} />
        <StatsCard label="Students on file" value={studentCount ?? 0} icon={Users} />
      </Section>

      <Section title="Services">
        <StatsCard label="Clearance in progress" value={clearanceOpen ?? 0} icon={ClipboardCheck} />
        <StatsCard label="Certificates issued" value={clearanceIssued ?? 0} icon={ClipboardCheck} iconTone="success" />
        <StatsCard label="Scholarship queue" value={scholarshipQueue ?? 0} icon={Award} />
        <StatsCard label="IDs validated this term" value={validatedIds ?? 0} icon={IdCard} iconTone="success" />
      </Section>

      <Section title="Campus access">
        <StatsCard label="Entries allowed" value={accessAllowed ?? 0} icon={DoorOpen} iconTone="success" />
        <StatsCard
          label="Denied scans"
          value={accessDenied ?? 0}
          icon={DoorOpen}
          iconTone={(accessDenied ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatsCard
          label="Open anomalies"
          value={openAnomalies ?? 0}
          icon={DoorOpen}
          iconTone={(openAnomalies ?? 0) > 0 ? "danger" : "neutral"}
        />
        <StatsCard
          label="Denial rate"
          value={
            (accessAllowed ?? 0) + (accessDenied ?? 0) > 0
              ? `${Math.round(((accessDenied ?? 0) / ((accessAllowed ?? 0) + (accessDenied ?? 0))) * 100)}%`
              : "—"
          }
          icon={DoorOpen}
        />
      </Section>

      {/* Per college (checklist I5) */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight">By college</h2>
            <p className="text-sm text-muted-foreground">
              Counts only. A college comes from the student&apos;s verified COR; without one, from their program.
            </p>
          </div>
          <a href="/staff/reports/export" className={csvLinkClass}>
            <Download className="h-3.5 w-3.5" /> All colleges (CSV)
          </a>
        </div>
        {collegeRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-base text-muted-foreground">
            No students on file yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-base tabular-nums">
              <thead className="border-b border-border bg-muted/40 text-left text-sm text-muted-foreground font-medium">
                <tr>
                  <th className="px-3 py-2 font-medium">College</th>
                  <th className="px-3 py-2 text-right font-medium">Students</th>
                  <th className="px-3 py-2 text-right font-medium">Cases (term)</th>
                  <th className="px-3 py-2 text-right font-medium">Open cases</th>
                  <th className="px-3 py-2 text-right font-medium">Concerns (term)</th>
                  <th className="px-3 py-2 text-right font-medium">IDs validated</th>
                  <th className="px-3 py-2 text-right font-medium">Clearances</th>
                  <th className="px-3 py-2 text-right font-medium">High risk</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...collegeRows, totalRow(collegeRows)].map((row) => {
                  const isTotal = row.college === "Total";
                  return (
                    <tr key={row.college} className={isTotal ? "bg-muted/30 font-semibold" : undefined}>
                      <td className="px-3 py-2">
                        {row.college}
                        {row.estimated > 0 && (
                          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                            ({row.estimated} by program)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{row.students}</td>
                      <td className="px-3 py-2 text-right">{row.casesThisTerm}</td>
                      <td className="px-3 py-2 text-right">{row.openCases}</td>
                      <td className="px-3 py-2 text-right">{row.concernsThisTerm}</td>
                      <td className="px-3 py-2 text-right">{row.idsValidated}</td>
                      <td className="px-3 py-2 text-right">{row.clearancesIssued}</td>
                      <td className="px-3 py-2 text-right">{row.highRisk}</td>
                      <td className="px-3 py-2 text-right">
                        {!isTotal && (
                          <a href={`/staff/reports/export?college=${encodeURIComponent(row.college)}`} className={csvLinkClass}>
                            <Download className="h-3 w-3" /> CSV
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Case pipeline */}
      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
          Cases by stage
        </h2>
        {byStatus.size === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-base text-muted-foreground">
            No cases on file yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {[...byStatus.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => {
                  const share = Math.round((count / cases.length) * 100);
                  return (
                    <li key={status} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-48 shrink-0 text-base">
                        {CASE_STATUS_META[status]?.label ?? status}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-tup-maroon-600"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums">
                        {count}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </section>

      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        Risk tiers are computed live from the active model and reflect only students with
        data on file. Report them as a workload measure, not as a prediction of outcomes.
      </p>
    </div>
  );
}

const csvLinkClass =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm font-medium text-tup-maroon-600 transition-colors hover:bg-muted";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}
