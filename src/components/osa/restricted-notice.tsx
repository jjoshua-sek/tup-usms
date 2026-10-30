import { LockIcon as Lock } from "@phosphor-icons/react/ssr";

import { PageHeader } from "@/components/shared/page-header";

interface RestrictedNoticeProps {
  title: string;
  /** Who *is* allowed, in plain words. */
  audience: string;
  /** What this person can do instead, such as a link to a page that is theirs. */
  children?: React.ReactNode;
}

/**
 * Shown when a staff member opens a queue their role doesn't cover.
 *
 * Saying who the screen is for — rather than a bare "access denied" — is what
 * stops people from filing a bug report when the answer is "ask an OSA head
 * to change your role".
 */
export function RestrictedNotice({ title, audience, children }: RestrictedNoticeProps) {
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: title }]}
        title={title}
      />
      <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <Lock className="h-7 w-7 text-muted-foreground/50" />
        <p className="max-w-sm text-sm text-muted-foreground">{audience}</p>
        {children}
      </div>
    </div>
  );
}
