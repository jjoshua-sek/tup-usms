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
    civil_status: data.civil_status || null,
    cellphone: data.cellphone || null,
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

  // Upsert: insert if no row, update if exists
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const { error } = await (supabase as any).from("students").upsert(
    {
      user_id: user.id,
      student_number: studentNumber,
      // Default placeholders for required fields not yet captured
      campus: "Manila",
      department: "TBD",
      program: "TBD",
      year_level: "1st Year",
      ...sanitized,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Step 1 save failed:", error);
    return { error: "Failed to save. Please try again." };
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
    return { error: "Failed to save. Please try again." };
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
    return { error: "Failed to save. Please try again." };
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
    return { error: "Failed to complete profile." };
  }

  await logAuditEvent(user.id, "profile_update", "students/finalize", {
    completed: true,
  });

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { success: true };
}
