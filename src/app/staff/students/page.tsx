import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { recordAccess } from "@/lib/students/access";
import { DIRECTORY_COLUMNS } from "@/lib/students/columns";
import { YEAR_LEVELS, parsePage, parseYearLevel, searchTokens, tokenFilter } from "@/lib/students/search";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Students",
};

const PAGE_SIZE = 25;

interface DirectoryRow {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  program: string;
  year_level: string;
  scholastic_status: string;
}

/**
 * The way into a student's record when you don't arrive from a case, a
 * clearance request or the risk queue.
 *
 * A plain GET form, so search works without client JavaScript and every
 * result page has a URL an officer can bookmark or send to a colleague.
 * Deliberately lists identity and enrolment only — the directory is a
 * finding aid, and each record's own page decides what its viewer may see.
 */
export default async function StaffStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; year?: string; page?: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff || !recordAccess(staff)) {
    return (
      <RestrictedNotice
        title="Students"
        audience="The student directory is open to OSA staff, guidance, the disciplinary committees, the Registrar and the Cashier."
      />
    );
  }

  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 120);
  const tokens = searchTokens(query);
  const year = parseYearLevel(params.year);
  const page = parsePage(params.page);

  const supabase = await createClient();
  let request = loose(supabase)
    .from("students")
    .select(DIRECTORY_COLUMNS, { count: "exact" });

  for (const token of tokens) request = request.or(tokenFilter(token));
  if (year) request = request.eq("year_level", year);

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await request
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (error) console.error("[students] directory query failed", error);

  const students = (data as DirectoryRow[] | null) ?? [];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = tokens.length > 0 || year !== null;

  const hrefFor = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (year) next.set("year", year);
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `/staff/students?${qs}` : "/staff/students";
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Students" }]}
        title="Students"
        description="Find a student by name, student number or program, then open their record."
      />

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="student-search" className="mb-1 block text-[12px] font-medium">
            Name, student number or program
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="student-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="e.g. Dela Cruz, TUPM-24-0123, BSIT"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tup-maroon-600/40"
            />
          </div>
        </div>

        <div>
          <label htmlFor="student-year" className="mb-1 block text-[12px] font-medium">
            Year level
          </label>
          <select
            id="student-year"
            name="year"
            defaultValue={year ?? ""}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tup-maroon-600/40"
          >
            <option value="">All years</option>
            {YEAR_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="h-9 rounded-md bg-tup-maroon-600 px-4 text-sm font-medium text-white hover:bg-tup-maroon-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tup-maroon-600/40 focus-visible:ring-offset-2"
        >
          Search
        </button>

        {filtered && (
          <Link
            href="/staff/students"
            className="h-9 content-center text-[13px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtered ? "No students match" : "No students yet"}
          description={
            filtered
              ? "Try part of the surname, or the student number without the campus prefix."
              : "Students appear here once they sign in and complete their profile."
          }
        />
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted-foreground">
            <span className="tabular-nums">{total}</span> student{total === 1 ? "" : "s"}
            {filtered ? " match" : ""}
            {pageCount > 1 && (
              <>
                {" "}
                · page <span className="tabular-nums">{page}</span> of{" "}
                <span className="tabular-nums">{pageCount}</span>
              </>
            )}
          </p>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Number
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Program
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Year level
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/staff/students/${student.id}`}
                        className="font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
                      >
                        {student.last_name}, {student.first_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums">
                      {student.student_number}
                    </td>
                    <td className="px-4 py-2.5">{student.program}</td>
                    <td className="px-4 py-2.5">{student.year_level}</td>
                    <td
                      className={cn(
                        "px-4 py-2.5",
                        student.scholastic_status !== "Regular" && "font-medium text-amber-800",
                      )}
                    >
                      {student.scholastic_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[13px]">
              {page > 1 ? (
                <Link
                  href={hrefFor(page - 1)}
                  className="inline-flex items-center gap-1 text-tup-maroon-600 underline-offset-2 hover:underline"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Previous
                </Link>
              ) : (
                <span />
              )}
              {page < pageCount && (
                <Link
                  href={hrefFor(page + 1)}
                  className="inline-flex items-center gap-1 text-tup-maroon-600 underline-offset-2 hover:underline"
                >
                  Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
