"use client";

import { useState, useTransition } from "react";
import {
  ExternalLink,
  Eye,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  getDocumentViewUrl,
  rejectAcademicDocument,
  rerunExtraction,
  verifyAcademicDocument,
} from "@/app/staff/documents/actions";
import { Button } from "@/components/ui/button";
import type { ExtractedAcademicData } from "@/types/osa";

/**
 * Opening the file is a two-step click on purpose: the signed URL is fetched
 * first and then offered as a link. Calling `window.open` after an await
 * trips popup blockers, and a blocked popup looks exactly like a broken
 * button to the person behind the counter.
 */
export function ViewFileButton({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-tup-maroon-600 transition-colors hover:bg-muted"
      >
        <ExternalLink className="h-3 w-3" />
        Open file (5 min link)
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await getDocumentViewUrl(documentId);
          if (result.error || !result.url) {
            toast.error(result.error ?? "Could not open that file.");
            return;
          }
          setUrl(result.url);
        })
      }
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
    >
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
      View document
    </button>
  );
}

/** Re-reads a document the model made a poor job of the first time. */
export function RerunExtractionButton({ documentId }: { documentId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await rerunExtraction(documentId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Read.");
        })
      }
      className="inline-flex items-center gap-1 rounded-md border border-ai-accent px-2 py-1 text-[11px] font-medium text-ai-accent transition-colors hover:bg-ai-accent-soft"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      {isPending ? "Reading…" : "Re-read with AI"}
    </button>
  );
}

interface VerifyFormProps {
  documentId: string;
  documentType: string;
  /** Figures the model read, used to pre-fill the form. */
  extracted?: ExtractedAcademicData | null;
}

export function DocumentReviewForms({
  documentId,
  documentType,
  extracted,
}: VerifyFormProps) {
  const [mode, setMode] = useState<"idle" | "verify" | "reject">("idle");
  const [isPending, startTransition] = useTransition();

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setMode("verify")}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
        >
          <ThumbsUp className="h-3 w-3" />
          Verify
        </button>
        <button
          type="button"
          onClick={() => setMode("reject")}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
        >
          <ThumbsDown className="h-3 w-3" />
          Reject
        </button>
      </div>
    );
  }

  if (mode === "reject") {
    return (
      <form
        action={(formData) =>
          startTransition(async () => {
            const result = await rejectAcademicDocument(formData);
            if (result.error) toast.error(result.error);
            else {
              toast.success(result.message ?? "Rejected.");
              setMode("idle");
            }
          })
        }
        className="w-full space-y-2 rounded-lg border border-border p-3"
      >
        <input type="hidden" name="document_id" value={documentId} />
        <Header title="Reject document" onCancel={() => setMode("idle")} />
        <textarea
          name="reason"
          required
          rows={2}
          maxLength={500}
          placeholder="What's wrong with it? The student sees this."
          className={inputClass}
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-full">
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Reject and notify
        </Button>
      </form>
    );
  }

  const isCor = documentType === "certificate_of_registration";

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await verifyAcademicDocument(formData);
          if (result.error) toast.error(result.error);
          else {
            toast.success(result.message ?? "Verified.");
            setMode("idle");
          }
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="document_id" value={documentId} />
      <Header title="Confirm the figures" onCancel={() => setMode("idle")} />

      {extracted && (
        <p className="rounded-md bg-ai-accent-soft p-2 text-[11px] leading-relaxed text-ai-accent">
          <Sparkles className="mr-1 inline h-3 w-3" />
          Pre-filled from the document. Check each figure against the page before
          confirming — you are the one signing for these numbers.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* A COR has no grades yet — only what the student enrolled in. */}
        {!isCor && (
          <label className="block space-y-1">
            <span className="text-[10px] font-medium">GWA</span>
            <input
              name="gwa"
              type="number"
              step="0.01"
              min="1"
              max="5"
              placeholder="2.25"
              defaultValue={extracted?.gwa ?? ""}
              className={inputClass}
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-[10px] font-medium">Units enrolled</span>
          <input
            name="units_enrolled"
            type="number"
            min="0"
            max="60"
            defaultValue={extracted?.units_enrolled ?? ""}
            className={inputClass}
          />
        </label>
        {!isCor && (
          <>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium">Units passed</span>
              <input
                name="units_passed"
                type="number"
                min="0"
                max="60"
                defaultValue={extracted?.units_passed ?? ""}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium">Units failed</span>
              <input
                name="units_failed"
                type="number"
                min="0"
                max="60"
                defaultValue={extracted?.units_failed ?? ""}
                className={inputClass}
              />
            </label>
          </>
        )}
        <label className="block space-y-1">
          <span className="text-[10px] font-medium">Standing</span>
          <input
            name="scholastic_status"
            maxLength={60}
            placeholder="Regular / Probation"
            defaultValue={extracted?.scholastic_status ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      {/* Subject-level read, so an officer can spot a misread row */}
      {(extracted?.subjects?.length ?? 0) > 0 && (
        <details className="rounded-md border border-border p-2">
          <summary className="cursor-pointer text-[11px] font-medium">
            {extracted!.subjects!.length} subjects read
            {isCor
              ? ` · ${extracted!.subjects!.reduce(
                  (sum, subject) => sum + (subject.schedule?.length ?? 0),
                  0,
                )} class times`
              : ""}
          </summary>
          <ul className="mt-2 space-y-1">
            {extracted!.subjects!.map((subject, index) => (
              <li key={`${subject.subject_code ?? index}`} className="text-[11px]">
                <span className="font-mono">{subject.subject_code ?? "—"}</span>
                {subject.units != null && (
                  <span className="text-muted-foreground"> · {subject.units}u</span>
                )}
                {subject.grade != null && (
                  <span className="text-muted-foreground"> · {String(subject.grade)}</span>
                )}
                {(subject.schedule?.length ?? 0) > 0 && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {subject
                      .schedule!.map(
                        (slot) =>
                          `${slot.day_of_week?.slice(0, 3) ?? "?"} ${slot.start_time ?? "?"}–${slot.end_time ?? "?"}`,
                      )
                      .join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {isCor && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Verifying imports these class times into the student&apos;s schedule, so
              hearings aren&apos;t booked on top of a lecture.
            </p>
          )}
        </details>
      )}

      <input
        name="notes"
        maxLength={1000}
        placeholder="Note for the file (optional)"
        className={inputClass}
      />

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Verify and save term snapshot
      </Button>
    </form>
  );
}

function Header({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold">{title}</p>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none";
