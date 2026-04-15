import { z } from "zod";

/**
 * Profile Step 1: Personal Information
 * Includes the mandatory DPA consent checkbox per RA 10173.
 */
export const profileStep1Schema = z.object({
  last_name: z
    .string()
    .min(1, "Last name is required")
    .max(100, "Last name is too long"),
  first_name: z
    .string()
    .min(1, "First name is required")
    .max(100, "First name is too long"),
  middle_name: z.string().max(100).optional().or(z.literal("")),
  name_extension: z.string().max(10).optional().or(z.literal("")),
  birth_date: z.coerce.date({
    message: "Birth date is required",
  }),
  birth_place: z.string().max(200).optional().or(z.literal("")),
  gender: z.enum(["Male", "Female", "Other", "Prefer not to say"], {
    message: "Please select your gender",
  }),
  citizenship: z.string().default("FILIPINO"),
  religion: z.string().max(100).optional().or(z.literal("")),
  civil_status: z
    .enum(["Single", "Married", "Widowed", "Separated", ""])
    .optional(),
  cellphone: z
    .string()
    .regex(/^\+63\d{10}$/, "Phone number must be in format +63XXXXXXXXXX")
    .optional()
    .or(z.literal("")),
  email_address: z.string().email("Please enter a valid email address"),
  // Address fields
  address_unit: z.string().max(100).optional().or(z.literal("")),
  address_street: z.string().max(200).optional().or(z.literal("")),
  address_barangay: z.string().min(1, "Barangay is required").max(200),
  address_city: z.string().min(1, "City/Municipality is required").max(200),
  address_province: z.string().min(1, "Province is required").max(200),
  address_zip: z
    .string()
    .regex(/^\d{4}$/, "ZIP code must be exactly 4 digits"),
  congressional_district: z.string().max(100).optional().or(z.literal("")),
  // DPA Consent - REQUIRED
  dpa_consent: z.literal(true, {
    message:
      "You must agree to the Data Privacy Act consent to continue. Your data will be processed in accordance with RA 10173.",
  }),
});

/**
 * Profile Step 2: Family Background
 */
export const profileStep2Schema = z.object({
  financial_support: z
    .enum([
      "Self-supporting",
      "Parent/Guardian",
      "Scholarship",
      "Working Student",
      "Other",
    ])
    .optional(),
  sponsor_name: z.string().max(200).optional().or(z.literal("")),
  is_indigenous: z.boolean().default(false),
  is_pwd: z.boolean().default(false),
  is_listahan: z.boolean().default(false),
});

/**
 * Profile Step 3: Academic Information
 */
export const profileStep3Schema = z.object({
  lrn: z
    .string()
    .regex(/^\d{12}$/, "LRN must be exactly 12 digits")
    .optional()
    .or(z.literal("")),
  campus: z.string().min(1, "Campus is required"),
  department: z.string().min(1, "Department is required"),
  program: z.string().min(1, "Program is required"),
  year_level: z.enum(["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"], {
    message: "Year level is required",
  }),
  section: z.string().max(20).optional().or(z.literal("")),
});

/**
 * Profile Step 4: Physical & Additional Info
 */
export const profileStep4Schema = z.object({
  height_cm: z
    .number()
    .min(50, "Height must be at least 50 cm")
    .max(300, "Height must be at most 300 cm")
    .optional()
    .nullable(),
  weight_lbs: z
    .number()
    .min(30, "Weight must be at least 30 lbs")
    .max(1000, "Weight must be at most 1000 lbs")
    .optional()
    .nullable(),
});

export type ProfileStep1Input = z.infer<typeof profileStep1Schema>;
export type ProfileStep2Input = z.infer<typeof profileStep2Schema>;
export type ProfileStep3Input = z.infer<typeof profileStep3Schema>;
export type ProfileStep4Input = z.infer<typeof profileStep4Schema>;
