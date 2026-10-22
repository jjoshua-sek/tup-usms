"use client";

import { useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { importAttendance, type ImportResult } from "@/app/staff/risk/attendance/actions";
import { Button } from "@/components/ui/button";

/** Upload one college's or the Registrar's attendance sheet for a term (checklist E2). */
export function AttendanceImportForm({ defaultSchoolYear, defaultSemester }: { defaultSchoolYear: string; defaultSemester: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);

  return (
    <div className="space-y-4">
      <form
        action={(formData) =>
          startTransition(async () => {
            const outcome = await importAttendance(formData);
            setResult(outcome);
            if (outcome.error) toast.error(outcome.error);
            else toast.success(`Imported attendance for ${outcome.imported} student${outcome.imported === 1 ? "" : "s"}.`);
          })
        }
        className="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-2"
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium">School year</span>
          <input name="school_year" defaultValue={defaultSchoolYear} pattern="\d{4}-\d{4}" required className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">Semester</span>
          <select name="semester" defaultValue={defaultSemester} className={inputClass}>
            <option>1st Semester</option>
            <option>2nd Semester</option>
            <option>Summer</option>
          </select>
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-medium">Sent by</span>
          <input name="source" required maxLength={120} placeholder="e.g. COS Dean's Office, or Registrar" className={inputClass} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-medium">Attendance sheet (CSV)</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
          />
        </label>
        <Button type="submit" disabled={pending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 sm:col-span-2">
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          {pending ? "Importing…" : "Import attendance"}
        </Button>
      </form>

      {result && !result.error && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">
            Imported {result.imported} student{result.imported === 1 ? "" : "s"}.
          </p>
          {(result.notFound?.length ?? 0) > 0 && (
            <p className="mt-1 text-muted-foreground">
              Not in STARS, so skipped: {result.notFound!.join(", ")}.
            </p>
          )}
          {(result.problems?.length ?? 0) > 0 && <Problems problems={result.problems!} />}
        </div>
      )}
      {result?.error && (result.problems?.length ?? 0) > 0 && <Problems problems={result.problems!} />}
    </div>
  );
}

function Problems({ problems }: { problems: Array<{ line: number; message: string }> }) {
  return (
    <div className="mt-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="mb-1 font-semibold">Rows skipped</p>
      <ul className="space-y-0.5">
        {problems.slice(0, 50).map((problem) => (
          <li key={`${problem.line}-${problem.message}`}>
            Line {problem.line}: {problem.message}
          </li>
        ))}
      </ul>
      {problems.length > 50 && <p className="mt-1">…and {problems.length - 50} more.</p>}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
