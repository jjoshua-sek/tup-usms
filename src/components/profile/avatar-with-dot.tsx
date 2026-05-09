import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AvatarWithDotProps {
  src?: string | null;
  fallback: string;
  /** Show the amber "provisional photo" dot in the corner */
  isProvisional?: boolean;
  className?: string;
  fallbackClassName?: string;
}

/**
 * Avatar component with optional provisional-photo dot indicator.
 * The dot is a small amber circle in the bottom-right corner with a tooltip-friendly title attribute.
 *
 * Used in sidebar, topbar, and staff student-detail page.
 */
export function AvatarWithDot({
  src,
  fallback,
  isProvisional,
  className,
  fallbackClassName,
}: AvatarWithDotProps) {
  return (
    <div
      className="relative inline-block"
      title={isProvisional ? "Provisional photo — student plans to replace it" : undefined}
    >
      <Avatar className={className}>
        {src && <AvatarImage src={src} alt="" />}
        <AvatarFallback className={fallbackClassName}>{fallback}</AvatarFallback>
      </Avatar>
      {isProvisional && (
        <span
          aria-label="Provisional photo indicator"
          className={cn(
            "absolute bottom-0 right-0 block rounded-full bg-amber-500 ring-2 ring-background",
            "h-2.5 w-2.5"
          )}
        />
      )}
    </div>
  );
}
