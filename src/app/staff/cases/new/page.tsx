import type { Metadata } from "next";

import {
  FileCaseForm,
  type ComplaintSource,
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
 *
 * Students complain through Concerns (category "Complaint"); the OSA opens
 * this page from that concern (?from_concern=) to file the case for them
 * (the OSA head's review of the checklist, A3).
 */
export default async function FileCasePage({
  searchParams,
}: {
  searchParams: Promise<{ from_concern?: string }>;
}) {
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

  const TYPE_COLUMNS = "id, code, name, description, default_classification, handbook_reference, typical_sanction, auto_route_codi";
  const loadTypes = (columns: string) =>
    db.from("violation_types").select(columns).eq("is_active", true).order("code", { ascending: true });
  // in_handbook arrives with 00049; until it runs, every type is a Manual offense.
  let { data: typeRows, error: typeError } = await loadTypes(`${TYPE_COLUMNS}, in_handbook`);
  if (typeError && ["PGRST204", "42703"].includes((typeError as { code?: string }).code ?? "")) {
    ({ data: typeRows, error: typeError } = await loadTypes(TYPE_COLUMNS));
  }

  const violationTypes = ((typeRows as ViolationTypeOption[] | null) ?? []).map((type) => ({
    ...type,
    in_handbook: type.in_handbook ?? true,
  }));

  // Filing a student's complaint (checklist A3): the OSA's step, read through
  // the officer's own access, which already covers concerns.
  const { from_concern: fromConcernId } = await searchParams;
  let fromComplaint: ComplaintSource | null = null;
  if (staff.isOsa && fromConcernId && /^[0-9a-f-]{36}$/i.test(fromConcernId)) {
    const { data: concernRow } = await db.from("concerns").select("*").eq("id", fromConcernId).maybeSingle();
    const concern = concernRow as {
      id: string;
      category: string;
      body_text: string;
      respondent_name?: string | null;
      respondent_details?: string | null;
      incident_date?: string | null;
      incident_location?: string | null;
    } | null;
    if (concern?.category === "Complaint" && concern.respondent_name) {
      fromComplaint = {
        concernId: concern.id,
        respondentName: concern.respondent_name,
        respondentDetails: concern.respondent_details ?? null,
        incidentDate: concern.incident_date ?? null,
        incidentLocation: concern.incident_location ?? null,
        description: concern.body_text,
      };
    }
  }

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
            fromComplaint={fromComplaint}
          />
        </div>
      )}
    </div>
  );
}
