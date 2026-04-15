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
 * Login form with:
 * - Student number (TUPM-XX-XXXX format) validation
 * - Password show/hide toggle
 * - Client-side rate limiting (5 attempts / 30s cooldown)
 * - Redirect back to intended page after login
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";

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

  const onSubmit = async (data: LoginInput) => {
    // Client-side rate limiting
    if (isInCooldown) {
      toast.error("Too many attempts. Please wait before trying again.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // Convert student number to email format for Supabase Auth
      const email = `${data.student_number.toLowerCase()}@tup.edu.ph`;

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: data.password,
      });

      if (error) {
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
          toast.error("Invalid student number or password.");
        }
        return;
      }

      // Success
      setFailedAttempts(0);
      toast.success("Signed in successfully!");
      router.push(redirectTo);
      router.refresh();
    } catch {
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
          Enter your TUP student number and password
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
