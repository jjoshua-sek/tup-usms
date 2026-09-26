import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { ProfileWizard } from "@/components/profile/profile-wizard";
import { ProfileEdit } from "@/components/profile/profile-edit";
import {
  isProfileComplete,
  profileStartingStep,
} from "@/lib/utils/profile-completeness";

export const metadata: Metadata = {
  title: "My Profile",
};

// Always re-fetch — student data may have just been written this turn
export const revalidate = 0;

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB types fall back to never on .select("*")
  const student = studentRaw as any;

  const complete = isProfileComplete(student);

  if (!complete) {
    // A student created from the enrollment list starts with what the
    // registrar already recorded — name, program, year, section and the
    // personal email the invitation went to — rather than a blank form
    // that invites the two records to disagree.
    let enrollment: Record<string, string> = {};
    if (!student) {
      const { data: invitation } = await loose(supabase)
        .from("account_invitations")
        .select("first_name, last_name, program, year_level, section, delivery_email")
        .eq("user_id", user.id)
        .maybeSingle();
      const row = invitation as {
        first_name: string;
        last_name: string;
        program: string | null;
        year_level: string | null;
        section: string | null;
        delivery_email: string;
      } | null;
      if (row) {
        enrollment = Object.fromEntries(
          Object.entries({
            first_name: row.first_name,
            last_name: row.last_name,
            program: row.program,
            year_level: row.year_level,
            section: row.section,
            email_address: row.delivery_email,
          }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
      }
    }

    return (
      <ProfileWizard
        initialData={student ?? enrollment}
        startingStep={profileStartingStep(student)}
        defaultEmail={enrollment.email_address ?? user.email ?? ""}
      />
    );
  }

  return <ProfileEdit student={student} />;
}
