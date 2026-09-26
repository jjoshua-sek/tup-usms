"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText, isAllowedMimeType, MAX_FILE_SIZE } from "@/lib/utils/sanitize";
import {
  profileStep1Schema,
  profileStep2Schema,
  profileStep3Schema,
} from "@/lib/validations/profile";

interface ActionResult {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  url?: string;
}

/**
 * Helper: get the authenticated user + ensure they have a student_number set.
 * The student_number is set during admin account creation; if it's missing,
 * we treat it as a configuration error.
 */
async function getAuthenticatedStudent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated.", supabase: null, user: null };
  }

  // Derive student_number from the email prefix (TUPM-XX-XXXX@tup.edu.ph)
  const emailPrefix = (user.email || "").split("@")[0].toUpperCase();
  const isStudentNumberFormat = /^TUPM-\d{2}-\d{4}$/.test(emailPrefix);
  const studentNumber = isStudentNumberFormat ? emailPrefix : null;

  return { supabase, user, studentNumber, error: null };
}

/**
 * Normalizes a Philippine mobile number to +63XXXXXXXXXX.
 *
 * Accepts every form students actually type:
 *   09171234567      → +639171234567
 *   +63 917 123 4567 → +639171234567
 *   0917-123-4567    → +639171234567
 *   639171234567     → +639171234567
 *
 * Returns null for empty input. Returns the digits-only original if the
 * value doesn't match a recognizable PH pattern — better to store
 * something the student can correct later than to silently discard it.
 */
function normalizePhoneNumber(input: string | undefined | null): string | null {
  if (!input) return null;

  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) return null;

  // 09171234567 → drop leading 0, prefix +63
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+63${digits.slice(1)}`;
  }
  // 639171234567 (with or without a typed +)
  if (digits.length === 12 && digits.startsWith("63")) {
    return `+${digits}`;
  }
  // 9171234567 — typed without the leading zero
  if (digits.length === 10 && digits.startsWith("9")) {
    return `+63${digits}`;
  }

  // Unrecognized shape (international number, typo). Preserve it rather
  // than dropping data the student entered deliberately.
  return input.trim();
}

/**
 * Translates a Postgres error into something a student can act on.
 *
 * Without this, a CHECK-constraint violation surfaces as the generic
 * "Failed to save. Please try again." — which is the worst possible
 * message, because retrying produces the identical failure. The student
 * has no way to learn that it was the phone field.
 */
function describeDbError(err: {
  message?: string;
  code?: string;
  details?: string;
}): string {
  const msg = err.message ?? "";

  // 23514 = check_violation
  if (err.code === "23514" || msg.includes("violates check constraint")) {
    if (msg.includes("cellphone")) {
      return "That phone number format wasn't accepted. Try 09171234567 or leave it blank.";
    }
    if (msg.includes("address_zip")) {
      return "ZIP code must be 3–6 digits (e.g. 1008).";
    }
    if (msg.includes("lrn")) {
      return "LRN must be exactly 12 digits, or left blank.";
    }
    if (msg.includes("gender")) {
      return "Please select a gender from the list.";
    }
    if (msg.includes("civil_status")) {
      return "Please select a civil status from the list, or leave it blank.";
    }
    return "One of the fields has an invalid value. Please review your entries.";
  }

  // 23505 = unique_violation
  if (err.code === "23505" || msg.includes("duplicate key")) {
    if (msg.includes("student_number")) {
      return "A profile already exists for this student number. Contact the Registrar.";
    }
    return "This record already exists.";
  }

  // 23502 = not_null_violation
  if (err.code === "23502" || msg.includes("null value in column")) {
    const match = msg.match(/column "(\w+)"/);
    return match
      ? `Required field missing: ${match[1].replace(/_/g, " ")}.`
      : "A required field is missing.";
  }

  // 42P10 = invalid_column_reference — the ON CONFLICT bug this file used
  // to hit. Surfaced explicitly so it is unmistakable if it recurs.
  if (msg.includes("no unique or exclusion constraint")) {
    return "Database configuration issue. Please run migration 00014 and try again.";
  }

  // Fall through with the raw message: an unhelpful specific error still
  // beats a helpful-sounding generic one, because it is reportable.
  return msg
    ? `Could not save: ${msg}`
    : "Failed to save. Please try again.";
}

// ============================================================
// STEP 1: Personal info + DPA consent
// ============================================================
export async function saveProfileStep1(formData: FormData): Promise<ActionResult> {
  const { supabase, user, studentNumber, error: authError } =
    await getAuthenticatedStudent();
  if (authError || !supabase || !user) return { error: authError || "Not authenticated." };

  // Build object from FormData
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "dpa_consent") {
      raw[k] = v === "true";
    } else {
      raw[k] = v;
    }
  }

  const parsed = profileStep1Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Please check your input.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Reject if not student number format (admins shouldn't be hitting this)
  if (!studentNumber) {
    return {
      error: "Your account doesn't have a student number. Please contact the Registrar.",
    };
  }

  const data = parsed.data;
  const sanitized = {
    last_name: sanitizeText(data.last_name, 100),
    first_name: sanitizeText(data.first_name, 100),
    middle_name: data.middle_name ? sanitizeText(data.middle_name, 100) : null,
    name_extension: data.name_extension ? sanitizeText(data.name_extension, 10) : null,
    birth_date: data.birth_date,
    birth_place: data.birth_place ? sanitizeText(data.birth_place, 200) : null,
    gender: data.gender,
    citizenship: data.citizenship,
    religion: data.religion ? sanitizeText(data.religion, 100) : null,
    // Empty string violates the CHECK constraint, which permits NULL or a
    // value from the allowed set — never ''.
    civil_status: data.civil_status || null,
    // Normalized to +63XXXXXXXXXX so stored numbers are consistent
    // regardless of how the student typed them.
    cellphone: normalizePhoneNumber(data.cellphone),
    email_address: data.email_address,
    address_unit: data.address_unit ? sanitizeText(data.address_unit, 100) : null,
    address_street: data.address_street ? sanitizeText(data.address_street, 200) : null,
    address_barangay: sanitizeText(data.address_barangay, 200),
    address_city: sanitizeText(data.address_city, 200),
    address_province: sanitizeText(data.address_province, 200),
    address_zip: data.address_zip,
    congressional_district: data.congressional_district
      ? sanitizeText(data.congressional_district, 100)
      : null,
    dpa_consent: data.dpa_consent,
    dpa_consent_date: new Date().toISOString(),
  };

  // Explicit check-then-write rather than upsert.
  //
  // upsert({ onConflict: "user_id" }) requires a UNIQUE constraint on that
  // column; the original schema created only a plain index, so every
  // upsert failed. Migration 00014 adds the constraint, but doing the
  // branch explicitly is clearer and yields far better error messages —
  // which matters because this is the first thing a new student ever does.
  const { data: existingRaw } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const existing = existingRaw as { id: string } | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const db = supabase as any;
  let writeError: { message?: string; code?: string; details?: string } | null = null;

  if (existing) {
    const { error } = await db
      .from("students")
      .update(sanitized)
      .eq("user_id", user.id);
    writeError = error;
  } else {
    // Academic placement is registrar-set, never student-supplied (step 3
    // passes it through without writing it). For an account created from
    // the enrollment list, the registrar's values are already on record in
    // the student's own invitation, read here on the server, so a student
    // cannot choose their own program by editing the form.
    // Section is not carried over: 00006 dropped students.section with the
    // enrollment module. It stays on the invitation as the registrar's record.
    const { data: invitationRaw } = await db
      .from("account_invitations")
      .select("program, year_level")
      .eq("user_id", user.id)
      .maybeSingle();
    const enrolled = invitationRaw as {
      program: string | null;
      year_level: string | null;
    } | null;

    const { error } = await db.from("students").insert({
      user_id: user.id,
      student_number: studentNumber,
      // Placeholders for NOT NULL academic columns when there is no
      // enrollment record to take them from (accounts made by hand).
      campus: "Manila",
      department: "TBD",
      program: enrolled?.program ?? "TBD",
      year_level: enrolled?.year_level ?? "1st Year",
      ...sanitized,
    });
    writeError = error;
  }

  if (writeError) {
    console.error("Step 1 save failed:", writeError);
    return { error: describeDbError(writeError) };
  }

  await logAuditEvent(user.id, "profile_update", "students/step1", {
    dpa_consent_given: true,
    fields_count: Object.keys(sanitized).length,
  });

  revalidatePath("/profile");
  return { success: true };
}

// ============================================================
// STEP 2: Family background
// ============================================================
export async function saveProfileStep2(formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await getAuthenticatedStudent();
  if (authError || !supabase || !user) return { error: authError || "Not authenticated." };

  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k === "is_indigenous" || k === "is_pwd" || k === "is_listahan") {
      raw[k] = v === "true";
    } else {
      raw[k] = v;
    }
  }

  const parsed = profileStep2Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Please check your input.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("students")
    .update({
      financial_support: data.financial_support || null,
      sponsor_name: data.sponsor_name ? sanitizeText(data.sponsor_name, 200) : null,
      is_indigenous: data.is_indigenous,
      is_pwd: data.is_pwd,
      is_listahan: data.is_listahan,
    })
    .eq("user_id", user.id);

  if (error) {
    console.error("Step 2 save failed:", error);
    return { error: describeDbError(error) };
  }

  await logAuditEvent(user.id, "profile_update", "students/step2");
  revalidatePath("/profile");
  return { success: true };
}

// ============================================================
// STEP 3: Academic info
// ============================================================
export async function saveProfileStep3(formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await getAuthenticatedStudent();
  if (authError || !supabase || !user) return { error: authError || "Not authenticated." };

  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    raw[k] = v;
  }

  const parsed = profileStep3Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Please check your input.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const data = parsed.data;

  // Note: campus/department/program/year_level were admin-set and we
  // pass them through but don't change them (security: students can't escalate).
  // Only the LRN field is genuinely editable here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("students")
    .update({
      lrn: data.lrn || null,
    })
    .eq("user_id", user.id);

  if (error) {
    console.error("Step 3 save failed:", error);
    return { error: describeDbError(error) };
  }

  await logAuditEvent(user.id, "profile_update", "students/step3");
  revalidatePath("/profile");
  return { success: true };
}

// ============================================================
// PHOTO UPLOAD: handles both file uploads and webcam blobs
// ============================================================
export async function uploadProfilePhoto(formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await getAuthenticatedStudent();
  if (authError || !supabase || !user) return { error: authError || "Not authenticated." };

  const file = formData.get("photo") as File | null;
  const isProvisional = formData.get("is_provisional") === "true";

  if (!file) return { error: "No photo provided." };

  // Validate
  if (file.size > MAX_FILE_SIZE) {
    return { error: "Photo too large. Max 10 MB." };
  }
  // For photos, we accept image/* (broader than the strict allowed list for documents)
  if (!file.type.startsWith("image/")) {
    return { error: "Photo must be an image." };
  }
  // Photos additionally must be JPEG, PNG, or WEBP (avoid weird formats)
  const allowedPhotoTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedPhotoTypes.includes(file.type)) {
    return { error: "Photo must be JPG, PNG, or WEBP." };
  }

  // Path: {user_id}/profile.{ext} — overwrites any existing photo
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/profile.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("student-photos")
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    console.error("Photo upload failed:", uploadError);
    return { error: "Photo upload failed. Please try again." };
  }

  // Public URL with cache-busting timestamp so browsers see the new photo
  const {
    data: { publicUrl },
  } = supabase.storage.from("student-photos").getPublicUrl(path);

  const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;

  // Update student record (or insert placeholder if it doesn't exist yet —
  // shouldn't happen since Step 1 always runs first, but defensive)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase as any)
    .from("students")
    .update({
      photo_url: cacheBustedUrl,
      photo_is_provisional: isProvisional,
    })
    .eq("user_id", user.id);

  if (updateError) {
    console.error("Photo URL save failed:", updateError);
    return { error: "Photo uploaded but failed to save. Please try again." };
  }

  await logAuditEvent(user.id, "profile_update", "students/photo", {
    is_provisional: isProvisional,
    file_size: file.size,
  });

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { success: true, url: cacheBustedUrl };
}

// ============================================================
// FINALIZE: complete the wizard
// ============================================================
export async function finalizeProfile(formData: FormData): Promise<ActionResult> {
  const { supabase, user, error: authError } = await getAuthenticatedStudent();
  if (authError || !supabase || !user) return { error: authError || "Not authenticated." };

  const heightStr = formData.get("height_cm") as string | null;
  const weightStr = formData.get("weight_lbs") as string | null;

  const height_cm = heightStr ? parseInt(heightStr, 10) : null;
  const weight_lbs = weightStr ? parseInt(weightStr, 10) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: Record<string, any> = {
    profile_completed_at: new Date().toISOString(),
  };
  if (height_cm !== null && !Number.isNaN(height_cm)) updatePayload.height_cm = height_cm;
  if (weight_lbs !== null && !Number.isNaN(weight_lbs)) updatePayload.weight_lbs = weight_lbs;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("students")
    .update(updatePayload)
    .eq("user_id", user.id);

  if (error) {
    console.error("Profile finalize failed:", error);
    return { error: describeDbError(error) };
  }

  await logAuditEvent(user.id, "profile_update", "students/finalize", {
    completed: true,
  });

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { success: true };
}
