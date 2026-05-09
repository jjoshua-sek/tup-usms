import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
    return (
      <ProfileWizard
        initialData={student ?? {}}
        startingStep={profileStartingStep(student)}
        defaultEmail={user.email ?? ""}
      />
    );
  }

  return <ProfileEdit student={student} />;
}
