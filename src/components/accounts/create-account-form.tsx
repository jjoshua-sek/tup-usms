"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { createAccount } from "@/app/staff/accounts/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAFF_ROLES, STAFF_ROLE_LABELS } from "@/types/osa";

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

/**
 * One account at a time, for whatever a bulk list doesn't cover: a late
 * enrollee, a student whose email bounced, a new staff member.
 *
 * A student can be emailed a link (the normal path) or given a password in
 * person — the fallback when the student has no working email. Staff always
 * get a password, handed over in person.
 */
export function CreateAccountForm() {
  const [kind, setKind] = useState<"student" | "staff">("student");
  const [delivery, setDelivery] = useState<"link" | "password">("link");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const needsPassword = kind === "staff" || delivery === "password";

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const result = await createAccount(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Account created.");
          formRef.current?.reset();
          setDelivery("link");
        })
      }
      className="space-y-4"
    >
      <input type="hidden" name="kind" value={kind} />

      <fieldset>
        <legend className="mb-1.5 text-[12px] font-medium">Account for</legend>
        <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup">
          {(["student", "staff"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "rounded px-3 py-1 text-[13px] font-medium",
                kind === option ? "bg-tup-maroon-600 text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "student" ? "A student" : "A staff member"}
            </button>
          ))}
        </div>
      </fieldset>

      {kind === "student" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Student number" hint="TUPM-XX-XXXX">
            <input name="student_number" required placeholder="TUPM-99-0001" className={inputClass} />
          </Field>
          <Field label="Personal email" hint="Where the sign-in link goes">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="First name">
            <input name="first_name" required maxLength={100} className={inputClass} />
          </Field>
          <Field label="Last name">
            <input name="last_name" required maxLength={100} className={inputClass} />
          </Field>
          <Field label="Program">
            <input name="program" required maxLength={120} placeholder="e.g. BSIT" className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year level">
              <select name="year_level" defaultValue="1st Year" className={inputClass}>
                {YEAR_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </Field>
            <Field label="Section" hint="Optional">
              <input name="section" maxLength={20} className={inputClass} />
            </Field>
          </div>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[12px] font-medium">How the student gets in</legend>
            <div className="space-y-1.5 text-[13px]">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delivery"
                  value="link"
                  checked={delivery === "link"}
                  onChange={() => setDelivery("link")}
                  className="mt-1"
                />
                <span>
                  Email a one-time link to choose their own password
                  <span className="block text-[11px] text-muted-foreground">Normal path. Nobody else ever knows the password.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delivery"
                  value="password"
                  checked={delivery === "password"}
                  onChange={() => setDelivery("password")}
                  className="mt-1"
                />
                <span>
                  Set a password now and give it to them in person
                  <span className="block text-[11px] text-muted-foreground">
                    For when the student can&apos;t receive email. No link is sent.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Login ID" hint="Staff use the same TUPM-XX-XXXX format">
            <input name="login_id" required placeholder="TUPM-99-0100" className={inputClass} />
          </Field>
          <Field label="Full name">
            <input name="full_name" required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Role" hint="Decides what they can see">
            <select name="role_type" defaultValue="osa_officer" className={inputClass}>
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {STAFF_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position">
            <input name="position" required maxLength={120} placeholder="e.g. OSA Officer" className={inputClass} />
          </Field>
          <Field label="Department">
            <input
              name="department"
              required
              maxLength={120}
              defaultValue="Office of Student Affairs"
              className={inputClass}
            />
          </Field>
          <Field label="Office" hint="Optional">
            <input name="office" maxLength={120} className={inputClass} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
            <input type="checkbox" name="can_access_confidential" className="mt-1" />
            <span>
              Cleared for confidential (CODI) cases
              <span className="block text-[11px] text-muted-foreground">
                Leave unticked unless this person sits on or supports the CODI.
              </span>
            </span>
          </label>
        </div>
      )}

      {needsPassword && (
        <Field
          label="Password"
          hint="8+ characters with an uppercase letter, a number and a symbol. Give it to the person directly, not by email."
        >
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            className={cn(inputClass, "sm:max-w-sm")}
          />
        </Field>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}
        Create account
      </Button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
