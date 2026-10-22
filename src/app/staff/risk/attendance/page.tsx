import type { Metadata } from "next";
import { Download } from "lucide-react";

import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { AttendanceImportForm } from "@/components/risk/attendance-import-form";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { ATTENDANCE_TEMPLATE } from "@/lib/risk/attendance-import";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDayTime } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Import Attendance",
};

export const dynamic = "force-dynamic";

interface ImportRow {
  batch_id: string | null;
  source: string;
  school_year: string;
  semester: string;
  imported_at: string;
}

/**
 * Attendance from the colleges or the Registrar (checklist E2), feeding the
 * early-warning score's attendance factor, which was empty until now.
 */
export default async function AttendanceImportPage() {
  const staff = await getStaffContext();
  if (!staff?.isOsa) {
    return <RestrictedNotice title="Import Attendance" audience="Attendance is imported by OSA officers and the OSA head." />;
  }

  const term = getCurrentTerm();
  const { data } = await loose(await createClient())
    .from("attendance_records")
    .select("batch_id, source, school_year, semester, imported_at")
    .order("imported_at", { ascending: false })
    .limit(2000);

  // One line per import, newest first.
  const imports = new Map<string, ImportRow & { students: number }>();
  for (const row of (data as ImportRow[] | null) ?? []) {
    const key = row.batch_id ?? `${row.source}|${row.school_year}|${row.semester}`;
    const existing = imports.get(key);
    if (existing) existing.students += 1;
    else imports.set(key, { ...row, students: 1 });
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "At-Risk", href: "/staff/risk" },
          { label: "Import attendance" },
        ]}
        title="Import attendance"
        description="Attendance sheets from the colleges or the Registrar. The early-warning score uses them from the next page load."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <AttendanceImportForm defaultSchoolYear={term.schoolYear} defaultSemester={term.semester} />

        <aside className="self-start space-y-3 rounded-md border border-border bg-accent p-5 text-sm">
          <h2 className="font-semibold">The file</h2>
          <p className="text-muted-foreground">
            A CSV with one row per student: <strong className="text-foreground">Student No.</strong>, then either{" "}
            <strong className="text-foreground">Sessions</strong> and <strong className="text-foreground">Absences</strong>, or an{" "}
            <strong className="text-foreground">Attendance %</strong> column. In Excel: File → Save As → CSV.
          </p>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(ATTENDANCE_TEMPLATE)}`}
            download="attendance-template.csv"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-tup-maroon-600 hover:bg-muted"
          >
            <Download className="h-3 w-3" /> Template (CSV)
          </a>
          <p className="text-xs text-muted-foreground">
            Importing a term again replaces each listed student&apos;s attendance for that term. Students not in STARS are
            skipped and listed.
          </p>
        </aside>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Imported so far</h2>
        {imports.size === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No attendance imported yet.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {[...imports.values()].map((row) => (
              <li key={`${row.batch_id}-${row.imported_at}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span>
                  <span className="font-medium">{row.source}</span>
                  <span className="ml-2 text-muted-foreground">
                    {row.semester}, {row.school_year}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {row.students} student{row.students === 1 ? "" : "s"} · {formatManilaMonthDayTime(row.imported_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
