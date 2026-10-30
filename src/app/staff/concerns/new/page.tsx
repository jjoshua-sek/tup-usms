import type { Metadata } from "next";
import { LockIcon as Lock } from "@phosphor-icons/react/ssr";

import { StaffConcernForm } from "@/components/concerns/staff-concern-form";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";

export const metadata: Metadata = {
  title: "Record a Concern",
};

export default async function RecordConcernPage() {
  const staff = await getStaffContext();
  const allowed = Boolean(staff && (staff.isOsa || staff.isCounselor));

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Concerns", href: "/staff/concerns" },
          { label: "Record" },
        ]}
        title="Record a concern"
        description="For a student who came to the counter, wrote a letter or email, or was referred by a faculty member."
      />

      {allowed ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <StaffConcernForm />
          <aside className="self-start rounded-md border border-border bg-accent p-5 text-sm">
            <h2 className="mb-2 font-semibold">What happens next</h2>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>It joins the Concern Queue with an AI summary, like one from the online form.</li>
              <li>The student sees it in their portal, marked as recorded by the OSA.</li>
              <li>For a faculty referral, the student can also be added to the At-Risk follow-up list.</li>
            </ul>
          </aside>
        </div>
      ) : (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
          <Lock className="h-7 w-7 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">Only OSA staff can record a concern for a student.</p>
        </div>
      )}
    </div>
  );
}
