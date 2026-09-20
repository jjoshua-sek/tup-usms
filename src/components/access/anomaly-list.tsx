"use client";

import { useTransition } from "react";
import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { reviewAnomaly } from "@/app/staff/gates/actions";

export interface AnomalyRow {
  id: string;
  anomaly_type:
    | "concurrent_use"
    | "passback_violation"
    | "repeated_denials"
    | "scan_while_suspended";
  severity: "low" | "medium" | "high";
  normalized_student_number: string | null;
  occurrence_count: number;
  details: Record<string, unknown> | null;
  last_detected_at: string;
  students: { first_name: string; last_name: string; student_number: string } | null;
}

const TYPE_LABELS: Record<AnomalyRow["anomaly_type"], string> = {
  concurrent_use: "Same ID at two gates",
  passback_violation: "Entry without an exit",
  repeated_denials: "Repeated denied scans",
  scan_while_suspended: "Scan on a suspended ID",
};

const TYPE_EXPLANATIONS: Record<AnomalyRow["anomaly_type"], string> = {
  concurrent_use:
    "One number cannot be at two gates at once — likely a shared screenshot or a copied card.",
  passback_violation:
    "The ID entered twice with no exit in between. Often a missed exit tap; sometimes a card handed back.",
  repeated_denials:
    "Several denied scans in a short window. Check whether the card is damaged or the validation lapsed.",
  scan_while_suspended:
    "Someone tried to use an ID whose campus privileges are on hold.",
};

const SEVERITY_CLASSES: Record<AnomalyRow["severity"], string> = {
  high: "border-red-200 bg-red-50 text-red-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-border bg-muted text-foreground",
};

interface AnomalyListProps {
  anomalies: AnomalyRow[];
  canManage: boolean;
}

/**
 * Anomalies are signals, not sanctions: nothing here blocks a student. OSA
 * reviews the pattern and, if it holds up, suspends the ID through the normal
 * validation workflow — which is what the gate actually enforces.
 */
export function AnomalyList({ anomalies, canManage }: AnomalyListProps) {
  const [isPending, startTransition] = useTransition();

  const review = (id: string, status: "confirmed" | "dismissed" | "reviewed") => {
    startTransition(async () => {
      const result = await reviewAnomaly(id, status);
      if (result.error) toast.error(result.error);
      else toast.success(status === "dismissed" ? "Dismissed." : "Marked for follow-up.");
    });
  };

  if (anomalies.length === 0) {
    return (
      <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
        <ShieldCheck className="h-6 w-6 text-emerald-600/60" />
        <p className="text-sm text-muted-foreground">
          No open anomalies. Gate traffic looks normal.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {anomalies.map((anomaly) => (
        <li
          key={anomaly.id}
          className={`rounded-xl border p-4 ${SEVERITY_CLASSES[anomaly.severity]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4" />
                {TYPE_LABELS[anomaly.anomaly_type]}
                {anomaly.occurrence_count > 1 && (
                  <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[10px]">
                    ×{anomaly.occurrence_count}
                  </span>
                )}
              </p>

              <p className="mt-1 text-[13px]">
                {anomaly.students
                  ? `${anomaly.students.first_name} ${anomaly.students.last_name} · `
                  : ""}
                <span className="font-mono">
                  {anomaly.students?.student_number ??
                    anomaly.normalized_student_number ??
                    "unknown"}
                </span>
              </p>

              <p className="mt-1.5 text-[12px] opacity-80">
                {TYPE_EXPLANATIONS[anomaly.anomaly_type]}
              </p>

              <p className="mt-1.5 text-[11px] opacity-70">
                Last seen{" "}
                {new Date(anomaly.last_detected_at).toLocaleString("en-PH", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {anomaly.details?.gate_label ? ` · ${String(anomaly.details.gate_label)}` : ""}
              </p>
            </div>

            {canManage && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => review(anomaly.id, "confirmed")}
                  className="rounded-md bg-white/70 p-1.5 transition-colors hover:bg-white"
                  aria-label="Confirm — needs follow-up"
                  title="Confirm — needs follow-up"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => review(anomaly.id, "dismissed")}
                  className="rounded-md bg-white/70 p-1.5 transition-colors hover:bg-white"
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
