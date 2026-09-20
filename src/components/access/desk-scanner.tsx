"use client";

import { useRef, useState, useTransition } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Keyboard,
  Loader2,
  ScanLine,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { verifyAtDesk, type DeskScanResult } from "@/app/staff/scanner/actions";
import { CameraScanner } from "@/components/access/camera-scanner";
import { Button } from "@/components/ui/button";

interface DeskScannerProps {
  /** Guards get the verdict without the discipline context. */
  canSeeCases: boolean;
}

interface HistoryEntry {
  key: string;
  label: string;
  decision: "allow" | "deny";
  detail: string;
  at: string;
}

/**
 * OSA front-desk verification.
 *
 * Accepts either a USB scanner (which types into the focused input and presses
 * Enter) or the camera. Unlike the gate kiosk this screen names the real
 * reason — staff are the ones who have to act on it.
 */
export function DeskScanner({ canSeeCases }: DeskScannerProps) {
  const [value, setValue] = useState("");
  const [useCamera, setUseCamera] = useState(false);
  const [result, setResult] = useState<DeskScanResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isPending, startTransition] = useTransition();
  const lastScanRef = useRef<{ payload: string; at: number } | null>(null);

  const runScan = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed) return;

    const previous = lastScanRef.current;
    if (previous && previous.payload === trimmed && Date.now() - previous.at < 2_000) return;
    lastScanRef.current = { payload: trimmed, at: Date.now() };

    startTransition(async () => {
      const scan = await verifyAtDesk(trimmed);
      if (scan.error) {
        toast.error(scan.error);
        return;
      }

      setResult(scan);
      setValue("");
      setHistory((current) =>
        [
          {
            key: `${scan.eventId ?? trimmed}-${Date.now()}`,
            label: scan.staffDetail?.studentNumber ?? trimmed,
            decision: scan.decision,
            detail: scan.hint,
            at: new Date().toLocaleTimeString("en-PH", {
              hour: "numeric",
              minute: "2-digit",
            }),
          },
          ...current,
        ].slice(0, 10),
      );
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      {/* Input */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-display text-sm font-semibold">Scan or type a student number</p>
            <button
              type="button"
              onClick={() => setUseCamera((current) => !current)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
            >
              {useCamera ? <Keyboard className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
              {useCamera ? "Use scanner" : "Use camera"}
            </button>
          </div>

          {useCamera ? (
            <CameraScanner onScan={runScan} />
          ) : (
            <div className="flex gap-2">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- a desk scanner is useless if the field isn't focused */}
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runScan(value);
                  }
                }}
                placeholder="TUPM-22-0148"
                spellCheck={false}
                className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-tup-maroon-600 focus:outline-none"
              />
              <Button
                type="button"
                onClick={() => runScan(value)}
                disabled={isPending}
                className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanLine className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          <p className="mt-2 text-[11px] text-muted-foreground">
            A USB scanner types the number and presses Enter on its own — just keep this field
            focused.
          </p>
        </div>

        {/* Session history */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-2.5 font-display text-sm font-semibold">
            This session
          </p>
          {history.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">No scans yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((entry) => (
                <li key={entry.key} className="flex items-center gap-2.5 px-4 py-2">
                  {entry.decision === "allow" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                  )}
                  <span className="flex-1 truncate font-mono text-xs">{entry.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {entry.detail}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{entry.at}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Result */}
      <div className="rounded-xl border border-border bg-card p-5">
        {!result ? (
          <div className="grid h-full place-content-center justify-items-center gap-3 py-16 text-center">
            <ScanLine className="h-8 w-8 text-muted-foreground/40" />
            <p className="max-w-xs text-sm text-muted-foreground">
              Scan a TUP ID to check its validation status for this term.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                result.decision === "allow"
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {result.decision === "allow" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {result.headline} — {result.hint}
            </div>

            <dl className="space-y-1.5 text-[13px]">
              <Row label="Name" value={result.staffDetail?.fullName ?? "—"} />
              <Row label="Student number" value={result.staffDetail?.studentNumber ?? "—"} mono />
              <Row label="Validation" value={result.staffDetail?.validationStatus ?? "none"} />
              <Row label="Term" value={result.staffDetail?.validationTerm ?? result.termLabel} />
              <Row
                label="Expires"
                value={
                  result.staffDetail?.expiresAt
                    ? new Date(result.staffDetail.expiresAt).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"
                }
              />
              {canSeeCases && (
                <Row
                  label="Open cases"
                  value={
                    result.openCases === null || result.openCases === undefined
                      ? "—"
                      : String(result.openCases)
                  }
                />
              )}
            </dl>

            {result.anomalyFlagged && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                This scan raised an access anomaly. It is queued for review under Gates &amp;
                Access — it does not block the student by itself.
              </p>
            )}

            <p className="text-[11px] text-muted-foreground">
              Every desk scan is logged with your name against the student&apos;s access
              history.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
