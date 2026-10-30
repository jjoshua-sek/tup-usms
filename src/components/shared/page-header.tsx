import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";

import { cn } from "@/lib/utils";

interface BreadcrumbSegment {
  /** Display label (e.g. "Home", "Discipline cases") */
  label: string;
  /** Optional href — when omitted, segment is rendered as plain text (final segment) */
  href?: string;
}

interface PageHeaderProps {
  title: string;
  /** One sentence under the title: what this page is for. */
  description?: string;
  /**
   * Where this page sits. Only the nearest linked parent is shown, as a
   * "Back to …" link, and only when that parent is not a home page: the
   * menu already shows where a top-level page is.
   * Example: [{label: "Staff", href: "/staff/dashboard"},
   *           {label: "Discipline cases", href: "/staff/cases"}, {label: "TUP-…"}]
   * → "← Back to Discipline cases"
   */
  breadcrumbs?: BreadcrumbSegment[];
  /** Right-side slot for the page's main button. */
  children?: React.ReactNode;
  className?: string;
}

const HOME_PAGES = new Set(["/dashboard", "/staff/dashboard"]);

/**
 * Page title, its one-line purpose, and the page's main button on the right.
 *
 *   ← Back to Discipline cases        (pages one level down only)
 *   Case title                [button]
 *   What this page is for
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
}: PageHeaderProps) {
  const parent = [...(breadcrumbs ?? [])].reverse().find((segment) => segment.href);
  const back = parent?.href && !HOME_PAGES.has(parent.href) ? parent : null;

  return (
    <div className={cn("mb-7", className)}>
      {back && (
        <Link
          href={back.href!}
          className="-ml-1 mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-base font-medium text-tup-maroon-700 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-tup-maroon-600/40"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          Back to {back.label}
        </Link>
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight leading-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="text-base text-muted-foreground mt-1 max-w-prose">
              {description}
            </p>
          )}
        </div>

        {children && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>
        )}
      </div>
    </div>
  );
}
