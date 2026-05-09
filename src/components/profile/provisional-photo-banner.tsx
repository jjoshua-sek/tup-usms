import { Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProvisionalPhotoBannerProps {
  /** When true, render the banner. */
  show: boolean;
  /** Optional click handler — typically scrolls to the photo edit section. */
  onReplaceClick?: () => void;
  className?: string;
}

/**
 * Persistent reminder shown on the /profile page when the student's photo
 * was captured via webcam and they chose "Use for now."
 *
 * Per the design, this is non-dismissible (the only way to make it disappear
 * is to upload/capture a non-provisional photo). It's also non-blocking —
 * students can use the rest of the page normally.
 */
export function ProvisionalPhotoBanner({
  show,
  onReplaceClick,
  className,
}: ProvisionalPhotoBannerProps) {
  if (!show) return null;

  const Wrapper = onReplaceClick ? "button" : "div";

  return (
    <Wrapper
      type={onReplaceClick ? "button" : undefined}
      onClick={onReplaceClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-left",
        onReplaceClick &&
          "cursor-pointer transition-colors hover:bg-amber-500/10",
        className
      )}
    >
      <div className="rounded-lg bg-amber-500/15 p-2 shrink-0">
        <Clock className="h-4 w-4 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          You&apos;re using a provisional photo
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
          Replace it anytime with a clearer photo for your student ID.
        </p>
      </div>
      {onReplaceClick && (
        <ChevronRight className="h-4 w-4 text-amber-600 shrink-0" />
      )}
    </Wrapper>
  );
}
