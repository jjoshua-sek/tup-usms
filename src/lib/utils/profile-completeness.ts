/**
 * Profile completeness logic.
 *
 * A student profile is considered "complete" when all the wizard's
 * required fields are filled AND the student has consented under DPA.
 * Photo IS required (per the design decision) — but a provisional
 * photo still counts as complete (the student can update it later).
 *
 * Used by:
 * - middleware.ts: gate non-profile pages for incomplete profiles
 * - dashboard/page.tsx: show onboarding prompt
 * - profile/page.tsx: decide between wizard vs. edit mode
 * - profile-wizard.tsx: determine which step to resume on
 */

export interface ProfileCheckable {
  // Step 1
  last_name?: string | null;
  first_name?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  email_address?: string | null;
  address_barangay?: string | null;
  address_city?: string | null;
  address_province?: string | null;
  address_zip?: string | null;
  dpa_consent?: boolean | null;

  // Step 3 (academic — admin pre-fills program/year_level)
  campus?: string | null;
  department?: string | null;
  program?: string | null;
  year_level?: string | null;

  // Step 4
  photo_url?: string | null;

  // Completion timestamp
  profile_completed_at?: string | null;
}

/**
 * Returns true if every required field has a non-empty value
 * AND DPA consent is recorded as true.
 */
export function isProfileComplete(student: ProfileCheckable | null): boolean {
  if (!student) return false;

  // Fast path: explicit completion timestamp
  if (student.profile_completed_at) return true;

  // Fall back to field check (in case timestamp wasn't set on legacy records)
  const required: (keyof ProfileCheckable)[] = [
    "last_name",
    "first_name",
    "birth_date",
    "gender",
    "email_address",
    "address_barangay",
    "address_city",
    "address_province",
    "address_zip",
    "campus",
    "department",
    "program",
    "year_level",
    "photo_url",
  ];

  for (const field of required) {
    const value = student[field];
    if (value === null || value === undefined || value === "") {
      return false;
    }
  }

  return student.dpa_consent === true;
}

/**
 * Determines which wizard step the student should resume on,
 * based on which required fields are still missing.
 *
 * Returns 1-4. Returns 1 for a brand-new student (no row yet).
 */
export function profileStartingStep(student: ProfileCheckable | null): number {
  if (!student) return 1;

  // Step 1 fields: personal info + DPA consent
  const step1Required: (keyof ProfileCheckable)[] = [
    "last_name",
    "first_name",
    "birth_date",
    "gender",
    "email_address",
    "address_barangay",
    "address_city",
    "address_province",
    "address_zip",
  ];

  const step1Done =
    student.dpa_consent === true &&
    step1Required.every((f) => {
      const v = student[f];
      return v !== null && v !== undefined && v !== "";
    });

  if (!step1Done) return 1;

  // Step 2 fields are all optional — skip detection here.
  // Step 3: academic info (program/year_level admin-set, but campus + department student confirmable)
  const step3Done =
    !!student.campus && !!student.department && !!student.program && !!student.year_level;

  if (!step3Done) return 3;

  // Step 4: photo
  if (!student.photo_url) return 4;

  // All done — shouldn't happen if isProfileComplete returned false,
  // but fall through safely to step 4 (photo) for re-confirmation.
  return 4;
}
