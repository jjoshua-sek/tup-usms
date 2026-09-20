import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarRange, FileText } from "lucide-react";

import {
  AddBlockForm,
  DeleteBlockButton,
} from "@/components/availability/availability-editor";
import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentTerm } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import type { AvailabilityBlockRow } from "@/types/osa";

export const metadata: Metadata = {
  title: "My Schedule",
};

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatTime(value: string): string {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minutes} ${suffix}`;
}

/**
 * The student's class schedule, expressed as busy blocks.
 *
 * This is the student half of the scheduling intersection in requirement #1:
 * the OSA scheduler crosses these blocks with the complainant professor's to
 * propose hearing times where neither party is in class.
 */
export default async function AvailabilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const term = getCurrentTerm();

  const { data: rows } = await loose(supabase)
    .from("availability_blocks")
    .select("*")
    .eq("user_id", user.id)
    .order("start_time", { ascending: true });

  const blocks = (rows as AvailabilityBlockRow[] | null) ?? [];
  const byDay = DAY_ORDER.map((day) => ({
    day,
    entries: blocks.filter((block) => block.day_of_week === day),
  })).filter((group) => group.entries.length > 0);

  const importedCount = blocks.filter((block) => block.source === "cor_import").length;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "My Schedule" }]}
        title="My Schedule"
        description={`When you're in class during ${term.label}. The OSA uses this to avoid scheduling meetings over your subjects.`}
      />

      <div className="mb-5 rounded-xl border border-ai-accent bg-ai-accent-soft p-4">
        <p className="flex items-start gap-2 text-[13px] leading-relaxed">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ai-accent" />
          <span>
            <strong className="text-ai-accent">Faster option:</strong> upload your
            Certificate of Registration under{" "}
            <strong>Academic Records</strong>. Once the OSA verifies it, your subjects and
            their meeting times are filled in here automatically —
            {importedCount > 0
              ? ` ${importedCount} block${importedCount === 1 ? "" : "s"} came from your COR.`
              : " nothing has been imported yet."}
          </span>
        </p>
      </div>

      <div className="mb-6">
        <AddBlockForm />
      </div>

      {byDay.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No class times recorded"
          description="Add the hours you're in class so a hearing is never scheduled on top of a subject. Without this, the scheduler can only avoid lunch and after-hours."
        />
      ) : (
        <div className="space-y-4">
          {byDay.map((group) => (
            <section key={group.day}>
              <h2 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.day}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {group.entries.map((block) => (
                  <li key={block.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-40 shrink-0 font-mono text-[13px] tabular-nums">
                      {formatTime(block.start_time)} – {formatTime(block.end_time)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {block.label ?? "Busy"}
                    </span>
                    {block.source === "cor_import" ? (
                      <ToneBadge label="From COR" tone="info" />
                    ) : (
                      <DeleteBlockButton blockId={block.id} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Only the OSA scheduling function reads these times, and only to find a meeting slot.
        Blocks imported from a verified COR can&apos;t be deleted here — ask the OSA if one
        is wrong.
      </p>
    </div>
  );
}
