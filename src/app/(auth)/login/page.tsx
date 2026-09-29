import type { Metadata } from "next";
import { Suspense } from "react";

import { AlreadySignedIn } from "@/components/auth/already-signed-in";
import { LoginForm } from "@/components/auth/login-form";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const role = user.app_metadata?.role;
    const isStaff = role === "staff" || role === "admin";
    // Accounts sign in as <STUDENT-NUMBER>@tup.edu.ph; show the number.
    const loginId = user.email?.split("@")[0]?.toUpperCase() ?? "this account";

    return (
      <AlreadySignedIn loginId={loginId} destination={isStaff ? "/staff/dashboard" : "/dashboard"} />
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
