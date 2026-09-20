import { cn } from "@/lib/utils";

/**
 * Status pill shared across the OSA screens.
 *
 * Every domain in this system carries its own status vocabulary
 * (CASE_STATUS_META, CLEARANCE_STATUS_META, ID_STATUS_META,
 * ELIGIBILITY_STATUS_META…) but they all resolve to the same five tones.
 * Centralising the colour mapping means a "danger" case badge and a "danger"
 * clearance badge can never drift to different reds.
 *
 * Deliberately not a Client Component: these render inside Server Component
 * lists, so keeping them server-side avoids shipping the whole list's markup
 * to the browser twice.
 */

export type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  warning: "bg-amber-50 text-amber-900 border-amber-200",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  danger: "bg-red-50 text-red-800 border-red-200",
};

interface ToneBadgeProps {
  label: string;
  tone?: Tone;
  className?: string;
}

export function ToneBadge({ label, tone = "neutral", className }: ToneBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneStyles[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
