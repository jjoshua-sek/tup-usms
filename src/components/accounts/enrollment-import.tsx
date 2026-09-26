"use client";

import { useState, useTransition } from "react";
import { Download, FileSpreadsheet, Loader2, UploadCloud, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  importEnrollmentChunk,
  previewEnrollment,
  startEnrollmentImport,
  type ImportRowResult,
  type PreviewResult,
} from "@/app/staff/accounts/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHUNK_SIZE = 25;

interface Summary {
  created: number;
  exists: number;
  failed: ImportRowResult[];
}

/**
 * Imitates enrollment: the registrar's list goes in, one account per
 * student comes out, and each student is emailed a one-time link to choose
 * their password.
 *
 * Two steps on purpose. "Check the list" writes nothing and shows every
 * problem first; only then does "Create accounts" run, in slices of 25 so a
 * large list shows progress rather than one long wait that might time out.
 */
export function EnrollmentImport() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pasting, setPasting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const rows = preview?.rows ?? [];
  const ready = rows.filter((row) => row.record && !row.exists);
  const existing = rows.filter((row) => row.exists);
  const invalid = rows.filter((row) => !row.record);

  const check = (formData: FormData) =>
    startTransition(async () => {
      setSummary(null);
      const result = await previewEnrollment(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setPreview(result);
    });

  const runImport = () =>
    startTransition(async () => {
      const start = await startEnrollmentImport();
      if (start.error || !start.batchId) {
        toast.error(start.error ?? "Could not start the import.");
        return;
      }

      const records = ready.map((row) => row.record!);
      const results: ImportRowResult[] = [];
      setProgress({ done: 0, total: records.length });

      for (let index = 0; index < records.length; index += CHUNK_SIZE) {
        const response = await importEnrollmentChunk({
          batchId: start.batchId,
          records: records.slice(index, index + CHUNK_SIZE),
        });
        if (response.error) {
          toast.error(response.error);
          break;
        }
        results.push(...(response.results ?? []));
        setProgress({ done: Math.min(index + CHUNK_SIZE, records.length), total: records.length });
      }

      const created = results.filter((result) => result.status === "created").length;
      setSummary({
        created,
        exists: results.filter((result) => result.status === "exists").length,
        failed: results.filter((result) => result.status === "error"),
      });
      setPreview(null);
      setProgress(null);
      if (created > 0) toast.success(`${created} account${created === 1 ? "" : "s"} created.`);
    });

  return (
    <div className="space-y-4">
      {!preview && (
        <form action={check} className="space-y-3">
          {pasting ? (
            <label className="block space-y-1">
              <span className="text-[12px] font-medium">Paste the list (CSV, with a header row)</span>
              <textarea
                name="csv"
                rows={6}
                spellCheck={false}
                placeholder={"student_number,first_name,last_name,email,program,year_level,section\nTUPM-99-0001,Juan,Dela Cruz,you+juan@gmail.com,BSIT,1st Year,A"}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] focus:border-tup-maroon-600 focus:outline-none"
              />
            </label>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:bg-muted/40">
              <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <span className="text-[13px] font-medium">Choose the enrollment list (.csv)</span>
              <span className="text-[11px] text-muted-foreground">
                Export it from a spreadsheet as CSV. Up to 1,000 students per file.
              </span>
              <input name="file" type="file" accept=".csv,text/csv" className="text-[12px]" />
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={isPending}
              className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              )}
              Check the list
            </Button>
            <button
              type="button"
              onClick={() => setPasting((value) => !value)}
              className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {pasting ? "Upload a file instead" : "Paste the list instead"}
            </button>
            <a
              href="/templates/enrollment-template.csv"
              download
              className="inline-flex items-center gap-1 text-[12px] text-tup-maroon-600 underline-offset-2 hover:underline"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Template
            </a>
          </div>
        </form>
      )}

      {preview?.fileErrors && preview.fileErrors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-900">
          {preview.fileErrors.map((message) => (
            <p key={message}>{message}</p>
          ))}
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="mt-2 text-[12px] font-medium underline-offset-2 hover:underline"
          >
            Choose another file
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-[13px]">
            <span className="font-semibold text-emerald-700">{ready.length} ready</span>
            {existing.length > 0 && (
              <span className="text-muted-foreground"> · {existing.length} already have accounts (skipped)</span>
            )}
            {invalid.length > 0 && (
              <span className="text-red-700"> · {invalid.length} with problems (skipped — fix and check again)</span>
            )}
          </p>

          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-[12px]">
              <thead className="sticky top-0 bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Line</th>
                  <th scope="col" className="px-3 py-2">Student</th>
                  <th scope="col" className="px-3 py-2">Link goes to</th>
                  <th scope="col" className="px-3 py-2">Program</th>
                  <th scope="col" className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.line} className={cn(!row.record && "bg-red-50/60")}>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{row.line}</td>
                    <td className="px-3 py-1.5">
                      {row.record ? (
                        <>
                          <span className="font-mono">{row.record.student_number}</span>
                          <span className="ml-1.5">
                            {row.record.last_name}, {row.record.first_name}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5">{row.record?.email ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      {row.record ? `${row.record.program} · ${row.record.year_level}` : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {!row.record ? (
                        <ul className="text-red-800">
                          {row.errors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      ) : row.exists ? (
                        <span className="text-muted-foreground">Already has an account</span>
                      ) : (
                        <span className="font-medium text-emerald-700">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {progress && (
            <div className="space-y-1" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-tup-maroon-600 transition-[width]"
                  style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                Created {progress.done} of {progress.total}…
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={runImport}
              disabled={isPending || ready.length === 0}
              className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1.5 h-4 w-4" />
              )}
              Create {ready.length} account{ready.length === 1 ? "" : "s"} and email sign-in links
            </Button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setPreview(null)}
              className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
          <p>
            <span className="font-semibold">{summary.created} created.</span>
            {summary.exists > 0 && ` ${summary.exists} already had accounts.`}
            {summary.failed.length > 0 && (
              <span className="text-red-700"> {summary.failed.length} could not be created.</span>
            )}
          </p>
          {summary.created > 0 && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              Sign-in links go out automatically, a few each minute, and appear under Invitations
              below as they are sent.
            </p>
          )}
          {summary.failed.length > 0 && (
            <ul className="mt-1 text-[12px] text-red-800">
              {summary.failed.map((result, index) => (
                <li key={`${result.student_number}-${index}`}>
                  {result.student_number}: {result.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
