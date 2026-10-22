import { NextResponse } from "next/server";

import { getCurrentTerm } from "@/lib/access/term";
import { buildCollegeReport, normalizeCollege, reportCsv, UNKNOWN_COLLEGE } from "@/lib/osa/college-report";
import { loadCollegeReportInput, reportTermStart } from "@/lib/osa/college-report-data";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";

/**
 * GET /staff/reports/export — the per-college report as CSV (checklist I5).
 *   no ?college   one row per college
 *   ?college=COS  one row per program in that college
 * Counts only, as on the page. Behind the staff area's sign-in like every
 * /staff route, and limited to who may see Reports.
 */
export async function GET(request: Request) {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && staff.role !== "osa_head")) {
    return NextResponse.json({ error: "Reports are available to OSA officers and the OSA head." }, { status: 403 });
  }

  const param = new URL(request.url).searchParams.get("college");
  const college = param === UNKNOWN_COLLEGE ? UNKNOWN_COLLEGE : normalizeCollege(param);
  if (param && !college) return NextResponse.json({ error: "Unknown college." }, { status: 400 });

  const term = getCurrentTerm();
  const input = await loadCollegeReportInput(loose(await createClient()), term, reportTermStart());
  const rows = buildCollegeReport(input, college ?? undefined);
  const csv = reportCsv(rows, { byProgram: Boolean(college), termLabel: term.label });

  await logAuditEvent(staff.userId, "report_exported", "reports", { college: college ?? "all" });

  const name = `stars-${college ? college.toLowerCase().replace(/\s+/g, "-") : "colleges"}-${term.schoolYear}-${term.semester.replace(/\s+/g, "-").toLowerCase()}.csv`;
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
