import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Reset Password",
};

export default function ResetPasswordPage() {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Reset Password</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your email address and we&apos;ll send you a link to reset your
          password.
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center">
          Password reset form will be rendered here with email input and submit
          button.
        </p>
        {/* TODO: Implement password reset form with email validation and Supabase auth */}
      </CardContent>
    </Card>
  );
}
