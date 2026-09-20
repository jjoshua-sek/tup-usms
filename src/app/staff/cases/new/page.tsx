import type { Metadata } from "next";

import {
  FileCaseForm,
  type ViolationTypeOption,
} from "@/components/cases/file-case-form";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "File a Case",
};

/**
 * The front door for requirement #4.
 *
 * Any staff member can file — faculty are the usual complainants, and the OSA
 * process document is explicit that the office also acts on its own
 * observation. The RLS policy ("staff files cases") says the same thing in
 * SQL, so this page is a convenience over the rule, not the rule itself.
 */
export default async function FileCasePage() {
  const staff = await getStaffContext();
  if (!staff) {
    return (
      <RestrictedNotice
        title="File a Case"
        audience="Only university staff and faculty can file a disciplinary complaint. Students should use Concerns instead."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: typeRows } = await db
    .from("violation_types")
    .select(
      "id, code, name, description, default_classification, handbook_reference, typical_sanction, auto_route_codi",
    )
    .eq("is_active", true)
    .order("code", { ascending: true });

  const violationTypes = (typeRows as ViolationTypeOption[] | null) ?? [];

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Staff", href: "/staff/dashboard" },
          { label: "Cases", href: "/staff/cases" },
          { label: "File a case" },
        ]}
        title="File a Case"
        description="A complaint starts the formal process. Nothing is sent to the student until the OSA has reviewed it."
      />

      {violationTypes.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No offense types configured"
          description="The violation_types table is empty, so there is nothing to file against. Run migration 00007, which seeds the Student Manual offenses."
        />
      ) : (
        <div className="max-w-3xl">
          <FileCaseForm
            violationTypes={violationTypes}
            defaultComplainantType={staff.role === "faculty" ? "faculty" : "staff"}
            canFileOsaInitiated={staff.isOsa}
            filerName={staff.fullName}
          />
        </div>
      )}
    </div>
  );
}
