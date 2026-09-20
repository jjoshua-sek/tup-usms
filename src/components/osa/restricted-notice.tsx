import { Lock } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";

interface RestrictedNoticeProps {
  title: string;
  /** Who *is* allowed, in plain words. */
  audience: string;
}

/**
 * Shown when a staff member opens a queue their role doesn't cover.
 *
 * Saying who the screen is for — rather than a bare "access denied" — is what
 * stops people from filing a bug report when the answer is "ask an OSA head
 * to change your role".
 */
export function RestrictedNotice({ title, audience }: RestrictedNoticeProps) {
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: title }]}
        title={title}
      />
      <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <Lock className="h-7 w-7 text-muted-foreground/50" />
        <p className="max-w-sm text-sm text-muted-foreground">{audience}</p>
      </div>
    </div>
  );
}
