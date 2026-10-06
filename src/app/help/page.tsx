import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { idleLimitMinutes } from "@/lib/auth/session-policy";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Help",
};

/**
 * Help for students and staff, reachable signed in or out — someone who
 * cannot sign in is the person most likely to need it, so /help is a public
 * route (src/middleware.ts). The header's Help link pointed at nothing until
 * this page existed.
 */
export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  const back = !user
    ? { href: "/login", label: "Back to sign in" }
    : role === "staff" || role === "admin"
      ? { href: "/staff/dashboard", label: "Back to the console" }
      : { href: "/dashboard", label: "Back to the dashboard" };

  const studentMinutes = idleLimitMinutes("student");
  const staffMinutes = idleLimitMinutes("staff");

  return (
    <div className="min-h-screen bg-muted px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-tup-maroon-600 hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {back.label}
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Help</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How to sign in, where to find things, and who to ask when something is wrong.
        </p>

        <div className="mt-8 space-y-5">
          <Section title="Signing in">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Students sign in with their student number (for example TUPM-22-0148), their password
                and their birth date. Staff sign in with their login ID and password.
              </li>
              <li>
                Accounts are created by the Office of Student Affairs. The first time, the OSA emails a
                one-time sign-in link to the personal email address on the enrollment list. Open it to
                choose your password.
              </li>
              <li>
                A link works once and expires after a short time. If yours no longer works, ask the OSA
                to send a new one.
              </li>
            </ul>
          </Section>

          <Section title="Forgot your password?">
            <p>
              Use <Link href="/reset-password" className="font-medium text-tup-maroon-600 hover:underline">Forgot password?</Link>{" "}
              on the sign-in page. Enter your student number and the email address your sign-in link was
              sent to, and a reset link arrives there within a few minutes. If it doesn&apos;t, the OSA
              can send one for you.
            </p>
          </Section>

          <Section title="Why was I signed out?">
            <p>
              For your security, you are signed out after {studentMinutes} minutes without activity
              ({staffMinutes} minutes for staff accounts), with a warning a minute before. Closing every
              tab of the site, or the browser, also signs you out. Nothing you saved is lost; sign in
              again to continue.
            </p>
          </Section>

          <Section title="Where to find things (students)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">I want to…</th>
                    <th className="py-2 font-medium">Go to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["Raise a problem or ask the OSA for help", "Concerns"],
                    ["See a summons or a meeting schedule", "My Appointments"],
                    ["Submit an apology letter or check a case", "My Violations"],
                    ["Find scholarships I qualify for", "Scholarships"],
                    ["Request a Good Moral certificate or clearance", "Clearance"],
                    ["Validate my ID for the term or show my QR code", "Digital ID"],
                    ["Upload my COR or rating slip", "Academic Records"],
                    ["Tell the OSA when I have classes", "My Schedule"],
                    ["Change my password or email settings", "Settings"],
                  ].map(([want, where]) => (
                    <tr key={want}>
                      <td className="py-2 pr-4">{want}</td>
                      <td className="py-2 font-medium">{where}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Your data">
            <p>
              Your information is processed under the Data Privacy Act of 2012 (RA 10173). To ask about
              your data, request a correction or raise a privacy concern, contact the University&apos;s Data
              Protection Officer at{" "}
              <a href="mailto:dpo@tup.edu.ph" className="font-medium text-tup-maroon-600 hover:underline">
                dpo@tup.edu.ph
              </a>
              .
            </p>
          </Section>

          <Section title="Still stuck?">
            <p>
              Visit the Office of Student Affairs. They can resend sign-in links, reset passwords and fix
              account details.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 text-sm leading-relaxed">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
