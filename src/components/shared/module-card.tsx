// Server Component (no "use client") — accepts Lucide icon props from Server pages.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModuleCardProps {
  /** Card title (e.g. "Electronic Registration") */
  title: string;
  /** One-line description of what the module does */
  description: string;
  /** Icon shown in the upper-left 36px square */
  icon: LucideIcon;
  /** Destination URL when card is clicked */
  href: string;
  /** "Open module →" text — defaults to "Open module →" */
  linkLabel?: string;
  /**
   * Visual variant.
   * - "default": maroon icon background
   * - "ai":      violet icon background + violet link, for AI-assisted modules
   *              (Submit Concern, AI Summary review, etc.)
   * - "neutral": muted icon background (for less-prominent modules)
   */
  variant?: "default" | "ai" | "neutral";
}

const variantStyles = {
  default: {
    iconBg:   "bg-tup-maroon-600 text-white",
    link:     "text-tup-maroon-600",
    hoverBorder: "hover:border-tup-maroon-600",
  },
  ai: {
    iconBg:   "bg-ai-accent text-white",
    link:     "text-ai-accent",
    hoverBorder: "hover:border-ai-accent",
  },
  neutral: {
    iconBg:   "bg-muted text-muted-foreground",
    link:     "text-foreground",
    hoverBorder: "hover:border-border",
  },
} as const;

/**
 * Module card for the dashboard "Quick Access" grid.
 *
 * Matches the mockup:
 *   ┌─────────────────────────┐
 *   │ ┌──┐                    │
 *   │ │📋│                    │
 *   │ └──┘                    │
 *   │ 15px title              │
 *   │ 12px description...     │
 *   │                         │
 *   │ Open module →           │
 *   └─────────────────────────┘
 *
 * Hover: border becomes the variant's accent color.
 * Whole card is clickable (Link wrapper).
 */
export function ModuleCard({
  title,
  description,
  icon: Icon,
  href,
  linkLabel = "Open module",
  variant = "default",
}: ModuleCardProps) {
  const styles = variantStyles[variant];

  return (
    <Link
      href={href}
      className={cn(
        "group block bg-card border border-border rounded-md p-5 transition-colors",
        styles.hoverBorder
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-md flex items-center justify-center mb-3",
          styles.iconBg
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <h3 className="text-[15px] font-semibold tracking-tight mb-1">
        {title}
      </h3>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {description}
      </p>

      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          styles.link
        )}
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
