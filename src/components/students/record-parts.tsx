import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MailCheck,
  type LucideIcon,
} from "lucide-react";

import {
  describeService,
  type GlanceItem,
  type NoticeDelivery,
  type Tone,
} from "@/lib/students/record-summary";
import { cn } from "@/lib/utils";
import { formatManilaDateTime } from "@/lib/utils/time";

/**
 * Building blocks for /staff/students/[id].
 *
 * Kept apart from the page so the page file is about who may see what and
 * where the rows come from, and this file is about how they look.
 */

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  info: "text-sky-800",
  warning: "text-amber-800",
  success: "text-emerald-700",
  danger: "text-red-700",
};

export function RecordSection({
  title,
  icon: Icon,
  count,
  href,
  hrefLabel = "Open queue",
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {title}
          {count !== undefined && (
            <span className="text-[12px] font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-tup-maroon-600 underline-offset-2 hover:underline"
          >
            {hrefLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/** A list whose rows share edges and padding, so sections line up with each other. */
export function RowList({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

export function Row({ children }: { children: React.ReactNode }) {
  return <li className="py-2.5 first:pt-0 last:pb-0">{children}</li>;
}

const GLANCE_COLUMNS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

/**
 * The strip an officer reads before anything else. Only the items the
 * viewer is entitled to see are passed in — a missing tile means "not
 * yours to see", never "zero".
 */
export function GlanceStrip({ items }: { items: GlanceItem[] }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border",
        GLANCE_COLUMNS[items.length] ?? "sm:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="bg-card px-4 py-3">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.label}
          </dt>
          <dd className={cn("mt-0.5 font-display text-[15px] font-semibold", TONE_TEXT[item.tone])}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const SERVICE_ICON: Record<Tone, LucideIcon> = {
  neutral: Clock,
  info: MailCheck,
  warning: Clock,
  success: CheckCircle2,
  danger: AlertTriangle,
};

export interface NoticeRow extends NoticeDelivery {
  id: string;
  title: string;
  notification_type: string;
  created_at: string;
}

/**
 * The proof-of-service log: every notice the system served on this
 * student, and the evidence that it arrived.
 *
 * State is carried by an icon as well as colour, and the headline says in
 * words which claim is being made — "Emailed" and "Opened" are not the same
 * fact, and an officer deciding whether to proceed ex parte should never
 * have to infer which one they are looking at.
 */
export function NoticeLog({ notices }: { notices: NoticeRow[] }) {
  return (
    <RowList>
      {notices.map((notice) => {
        const evidence = describeService(notice);
        const Icon = SERVICE_ICON[evidence.tone];
        const facts = [
          evidence.openedAt && `Opened ${formatManilaDateTime(evidence.openedAt)}`,
          evidence.emailedAt &&
            `Emailed to ${evidence.emailedTo ?? "address of record"} ${formatManilaDateTime(evidence.emailedAt)}`,
        ].filter(Boolean);

        return (
          <Row key={notice.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-[13px] font-medium">{notice.title}</p>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatManilaDateTime(notice.created_at)}
              </span>
            </div>
            <p className={cn("mt-1 flex items-start gap-1.5 text-[12px]", TONE_TEXT[evidence.tone])}>
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {evidence.headline}
            </p>
            {facts.length > 0 && (
              <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">{facts.join(" · ")}</p>
            )}
          </Row>
        );
      })}
    </RowList>
  );
}
