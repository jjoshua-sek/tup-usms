import Link from "next/link";
import { cn } from "@/lib/utils";

interface BreadcrumbSegment {
  /** Display label (e.g. "Home", "Dashboard") */
  label: string;
  /** Optional href — when omitted, segment is rendered as plain text (final segment) */
  href?: string;
}

interface PageHeaderProps {
  /** Page title (h2-sized, 26px) */
  title: string;
  /** Optional muted subtitle below the title */
  description?: string;
  /**
   * Breadcrumb segments rendered above the title in Geist Mono.
   * Example: [{label: "Home", href: "/dashboard"}, {label: "Concerns"}]
   * → "Home / Concerns"
   */
  breadcrumbs?: BreadcrumbSegment[];
  /**
   * Right-side slot for action buttons. Common pattern:
   * <PageHeader ...><Button>+ New Concern</Button></PageHeader>
   */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Institutional page header.
 *
 * Layout:
 *   HOME / CONCERNS                  ← Geist Mono, 11px, uppercase tracking
 *   Concern Review                   ← 26px semibold, tight tracking
 *   Manage student submissions...    ← 13px muted
 *
 *   ┌──────────────────────────────┐
 *   │ Title                  [btn] │ (when children are provided,
 *   │ Subtitle                     │  they sit on the right, top-aligned)
 *   └──────────────────────────────┘
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-7", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 mb-2 font-mono text-[11px] text-muted-foreground"
        >
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {seg.href ? (
                <Link
                  href={seg.href}
                  className="hover:text-foreground transition-colors"
                >
                  {seg.label}
                </Link>
              ) : (
                <span>{seg.label}</span>
              )}
              {i < breadcrumbs.length - 1 && (
                <span className="opacity-50" aria-hidden="true">
                  /
                </span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
            {title}
          </h1>
          {description && (
            <p className="text-[13px] text-muted-foreground mt-1">
              {description}
            </p>
          )}
        </div>

        {children && (
          <div className="flex items-center gap-2 shrink-0">{children}</div>
        )}
      </div>
    </div>
  );
}
