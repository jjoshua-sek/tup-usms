"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";

/**
 * Login form mirroring TUP-Manila ERS UX:
 * - Student number (TUPM-XX-XXXX) — staff/admin use placeholder format like TUPM-26-0000
 * - Password (with show/hide toggle)
 * - Birth date — verified against students.birth_date for student logins,
 *   skipped for staff/admin
 *
 * Other features:
 * - Client-side rate limiting (5 attempts / 30s cooldown)
 * - Redirect back to intended page after login
 * - Role-aware redirect (students → /dashboard, staff/admin → /staff/dashboard)
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      student_number: "",
      password: "",
    },
  });

  const isInCooldown = cooldownUntil > Date.now();

  /**
   * Compare two dates as YYYY-MM-DD strings, ignoring time/timezone.
   * Birthday match is intentionally lenient — we only care about the calendar date.
   * The form input is already a YYYY-MM-DD string from <input type="date">.
   * The DB value may have a time/timezone component, so we trim to just the date part.
   */
  const sameCalendarDate = (formInput: string, dbValue: string): boolean => {
    const dbDateOnly = dbValue.split("T")[0]; // strip timezone/time if present
    return formInput === dbDateOnly;
  };

  const handleFailedAttempt = (message: string) => {
    const newAttempts = failedAttempts + 1;
    setFailedAttempts(newAttempts);

    if (newAttempts >= 5) {
      // 30-second cooldown after 5 failed attempts
      setCooldownUntil(Date.now() + 30000);
      setFailedAttempts(0);
      toast.error(
        "Too many failed attempts. Please wait 30 seconds before trying again."
      );
    } else {
      toast.error(message);
    }
  };

  const onSubmit = async (data: LoginInput) => {
    if (isInCooldown) {
      toast.error("Too many attempts. Please wait before trying again.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // Convert student number to email format used by Supabase Auth
      const email = `${data.student_number.toLowerCase()}@tup.edu.ph`;

      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });

      if (error || !authData.user) {
        handleFailedAttempt("Invalid student number or password.");
        return;
      }

      // Determine the user's role from app_metadata (server-controlled, secure).
      // Never read role from user_metadata — users can self-modify that.
      const role = authData.user.app_metadata?.role || "student";

      // For students: do birthday verification AND check profile completion in
      // one query, so we can route them directly to /profile or /dashboard
      // and avoid the redirect chain that causes the "white screen" issue.
      let studentNeedsOnboarding = false;
      if (role === "student") {
        const { data: studentRecord } = await supabase
          .from("students")
          .select("birth_date, profile_completed_at")
          .eq("user_id", authData.user.id)
          .maybeSingle();

        const studentData = studentRecord as
          | { birth_date: string | null; profile_completed_at: string | null }
          | null;

        // Birthday verification (only when a profile already has a birth_date set)
        if (studentData?.birth_date) {
          const matches = sameCalendarDate(
            data.birth_date,
            studentData.birth_date
          );
          if (!matches) {
            await supabase.auth.signOut();
            handleFailedAttempt("Birth date does not match our records.");
            return;
          }
        }

        // No profile or incomplete? Send straight to /profile (avoids
        // the /dashboard → /profile redirect chain).
        studentNeedsOnboarding =
          !studentData || !studentData.profile_completed_at;
      }

      // Successful login — pick destination and navigate ONCE.
      setFailedAttempts(0);
      toast.success("Signed in successfully!");

      let destination: string;
      if (redirectTo) {
        destination = redirectTo;
      } else if (role === "staff" || role === "admin") {
        destination = "/staff/dashboard";
      } else if (studentNeedsOnboarding) {
        destination = "/profile";
      } else {
        destination = "/dashboard";
      }

      // router.replace() (not push) so the back button doesn't return to /login.
      // No router.refresh() — the route change triggers a fresh server render
      // by itself, and refresh() can race with replace() causing white-screen issues.
      router.replace(destination);
    } catch (err) {
      console.error("Login error:", err);
      toast.error("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Sign In</CardTitle>
        <CardDescription>
          Enter your TUP credentials to continue
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-4">
          {/* Student Number */}
          <div className="space-y-2">
            <Label htmlFor="student_number">Student Number</Label>
            <Input
              id="student_number"
              placeholder="TUPM-XX-XXXX"
              autoComplete="username"
              disabled={isLoading || isInCooldown}
              {...register("student_number")}
              className={errors.student_number ? "border-destructive" : ""}
            />
            {errors.student_number && (
              <p className="text-xs text-destructive">
                {errors.student_number.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={isLoading || isInCooldown}
                {...register("password")}
                className={errors.password ? "border-destructive pr-10" : "pr-10"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Birth Date */}
          <div className="space-y-2">
            <Label htmlFor="birth_date">Birth Date</Label>
            <Input
              id="birth_date"
              type="date"
              autoComplete="bday"
              disabled={isLoading || isInCooldown}
              {...register("birth_date")}
              className={errors.birth_date ? "border-destructive" : ""}
            />
            {errors.birth_date && (
              <p className="text-xs text-destructive">
                {errors.birth_date.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              For verification, like the existing TUP ERS.
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            className="w-full bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
            disabled={isLoading || isInCooldown}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : isInCooldown ? (
              "Please wait..."
            ) : (
              "Sign In"
            )}
          </Button>
          <Link
            href="/reset-password"
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            Forgot your password?
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
