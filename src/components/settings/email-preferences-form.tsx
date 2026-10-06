"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveEmailPreferences } from "@/lib/accounts/account-actions";
import { Button } from "@/components/ui/button";
import type { NotificationPreferences } from "@/lib/notifications/policy";

const CATEGORIES: Array<{ name: keyof NotificationPreferences; label: string; hint: string }> = [
  { name: "scholarship_alerts", label: "Scholarships", hint: "New matches, deadlines and status changes" },
  { name: "guidance_reminders", label: "Guidance", hint: "Session reminders and follow-ups" },
  { name: "announcements", label: "Announcements", hint: "General notices from the OSA" },
];

/**
 * Which optional emails to receive. Students see each category; staff see
 * only the master switch, and their other values ride along as hidden
 * fields so saving the form never changes them.
 */
export function EmailPreferencesForm({
  initial,
  categories = true,
}: {
  initial: NotificationPreferences;
  categories?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [emailOn, setEmailOn] = useState(initial.email_enabled);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await saveEmailPreferences(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Saved.");
        })
      }
      className="space-y-4"
    >
      <Toggle
        name="email_enabled"
        label="Email me copies of my notifications"
        hint="Everything still appears in the portal either way."
        checked={emailOn}
        onChange={setEmailOn}
        disabled={isPending}
      />

      {categories ? (
        // Dimmed rather than disabled while email is off: a disabled checkbox
        // is left out of the submitted form, which would save every category
        // as off and lose the choices for when email is switched back on.
        <fieldset
          className={`space-y-3 border-l-2 border-border pl-4 transition-opacity ${emailOn ? "" : "pointer-events-none opacity-50"}`}
          aria-disabled={!emailOn}
          disabled={isPending}
        >
          <legend className="sr-only">Optional email categories</legend>
          {CATEGORIES.map((category) => (
            <Toggle
              key={category.name}
              name={category.name}
              label={category.label}
              hint={category.hint}
              defaultChecked={initial[category.name]}
            />
          ))}
        </fieldset>
      ) : (
        CATEGORIES.map((category) =>
          initial[category.name] ? <input key={category.name} type="hidden" name={category.name} value="on" /> : null,
        )
      )}

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save email settings
      </Button>
    </form>
  );
}

function Toggle({
  name,
  label,
  hint,
  checked,
  defaultChecked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  hint: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = `pref-${name}`;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 accent-tup-maroon-600"
      />
      <label htmlFor={id} className="text-sm leading-tight">
        <span className="font-medium">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}
