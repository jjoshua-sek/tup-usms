import type { Metadata } from "next";
import { Zap } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { ConcernFormInline } from "@/components/concerns/concern-form-inline";

export const metadata: Metadata = {
  title: "File a Concern",
};

export default function NewConcernPage() {
  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Concerns", href: "/concerns" },
          { label: "New" },
        ]}
        title="File a new concern."
        description="Describe your concern in detail. You may write in English, Filipino, or Taglish — the system handles all three."
      />

      {/* Two-column layout: form (left, ~2/3) + info card (right, ~1/3) */}
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <ConcernFormInline />

        {/* Info card — "What happens next?" */}
        <aside className="bg-accent border border-border rounded-md p-5 self-start">
          <h4 className="text-sm font-semibold mb-2.5">What happens next?</h4>

          <ol className="list-none space-y-0 mt-2" style={{ counterReset: "step" }}>
            <Step n={1}>
              Your concern is stored in the unified queue and timestamped.
            </Step>
            <Step n={2}>
              An AI summary is generated to help staff triage faster — your
              original text is always visible to reviewers.
            </Step>
            <Step n={3}>
              You receive a notification when staff respond, usually within
              1–2 working days.
            </Step>
            <Step n={4}>
              Track status anytime under{" "}
              <strong className="text-foreground">Concerns → My Submissions</strong>.
            </Step>
          </ol>

          {/* AI notice */}
          <div className="bg-ai-accent-soft border border-ai-accent rounded-md p-3 mt-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-3 w-3 text-ai-accent" />
              <strong className="text-xs font-semibold text-ai-accent">
                About the AI triage
              </strong>
            </div>
            <p className="text-[11px] text-ai-accent leading-relaxed">
              Your concern is processed by Claude Sonnet 4 to generate a
              routing summary. Final decisions are always made by a human
              staff member. Read more in the Privacy Notice.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="text-xs text-muted-foreground py-2 pl-7 relative leading-relaxed border-b border-border last:border-0">
      <span className="absolute left-0 top-2 w-5 h-5 bg-tup-maroon-600 text-white rounded-full flex items-center justify-center text-[10px] font-semibold font-mono">
        {n}
      </span>
      {children}
    </li>
  );
}
