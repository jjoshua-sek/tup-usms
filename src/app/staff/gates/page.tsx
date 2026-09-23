import type { Metadata } from "next";
import { DoorOpen, Lock, ShieldAlert, XCircle } from "lucide-react";

import { AccessFeed, type AccessEventRow } from "@/components/access/access-feed";
import { AnomalyList, type AnomalyRow } from "@/components/access/anomaly-list";
import { GateConsole, isGateOnline, type GateRow } from "@/components/access/gate-console";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getAccessStaff } from "@/lib/access/guards";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { startOfManilaDay } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Gates & Access",
};

// The live feed keeps itself current over Realtime; this only governs the
// first paint after a navigation.
export const revalidate = 30;

export default async function StaffGatesPage() {
  const staff = await getAccessStaff();

  if (!staff?.canView) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Gates & Access" }]}
          title="Gates & Access"
        />
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
          <Lock className="h-7 w-7 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">
            Campus access is limited to OSA officers, the OSA head and security personnel.
            Ask an administrator if you need this view.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  // Today's entries and denials count from Manila midnight. The server's own
  // midnight is UTC's, which falls at 8 AM here.
  const dayStartIso = startOfManilaDay().toISOString();

  const [
    { data: gatesRaw },
    { data: eventsRaw },
    { data: anomaliesRaw },
    { count: allowedToday },
    { count: deniedToday },
  ] = await Promise.all([
    db.from("access_gates").select("*").order("name", { ascending: true }),
    db
      .from("access_events")
      .select(
        "id, gate_label, direction, decision, enforced, reason, normalized_student_number, occurred_at",
      )
      .order("occurred_at", { ascending: false })
      .limit(40),
    db
      .from("access_anomalies")
      .select(
        "id, anomaly_type, severity, normalized_student_number, occurrence_count, details, last_detected_at, students(first_name, last_name, student_number)",
      )
      .eq("status", "open")
      .order("last_detected_at", { ascending: false })
      .limit(20),
    db
      .from("access_events")
      .select("id", { count: "exact", head: true })
      .eq("decision", "allow")
      .gte("occurred_at", dayStartIso),
    db
      .from("access_events")
      .select("id", { count: "exact", head: true })
      .eq("decision", "deny")
      .gte("occurred_at", dayStartIso),
  ]);

  const gates = (gatesRaw as GateRow[] | null) ?? [];
  const events = (eventsRaw as AccessEventRow[] | null) ?? [];
  const anomalies = (anomaliesRaw as AnomalyRow[] | null) ?? [];

  const onlineGates = gates.filter((gate) => isGateOnline(gate.last_seen_at)).length;
  const enforcingGates = gates.filter(
    (gate) => gate.enforcement_mode === "enforce" && gate.is_active,
  ).length;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Gates & Access" }]}
        title="Gates & Access"
        description="QR turnstile terminals, live scan activity, and abuse signals for review."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Gates online"
          value={`${onlineGates}/${gates.length}`}
          icon={DoorOpen}
          trend={`${enforcingGates} enforcing`}
        />
        <StatsCard label="Entries today" value={allowedToday ?? 0} icon={DoorOpen} iconTone="success" />
        <StatsCard
          label="Denied today"
          value={deniedToday ?? 0}
          icon={XCircle}
          iconTone={(deniedToday ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatsCard
          label="Open anomalies"
          value={anomalies.length}
          icon={ShieldAlert}
          iconTone={anomalies.length > 0 ? "danger" : "neutral"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Terminals</h2>
            <GateConsole gates={gates} canManage={staff.canManage} />
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Each lane runs <span className="font-mono">/kiosk</span> in a browser and pairs
              once with its device key. Start a new lane in <strong>monitor</strong> mode: it
              records every scan and opens for everyone, so a week of real traffic surfaces the
              unvalidated IDs before anyone is held at the arm.
            </p>
          </section>

          <section>
            <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
              Anomalies for review
            </h2>
            <AnomalyList anomalies={anomalies} canManage={staff.canManage} />
          </section>
        </div>

        <AccessFeed initialEvents={events} />
      </div>
    </div>
  );
}
