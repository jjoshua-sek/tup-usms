import { z } from "zod";

/**
 * Login form validation.
 * Mirrors TUP-Manila ERS login UX: student_number + password + birth_date.
 *
 * - student_number format: TUPM-XX-XXXX (XX = 2-digit year, XXXX = 4-digit sequence)
 *   Staff/admin accounts use a placeholder student-number format
 *   (e.g., TUPM-26-0000) to keep the login UI consistent.
 * - birth_date is enforced server-side ONLY for users with role = 'student'
 *   (admins/staff bypass this check since they have no students row).
 */
export const loginSchema = z.object({
  student_number: z
    .string()
    .regex(
      /^TUPM-\d{2}-\d{4}$/,
      "Student number must be in format TUPM-XX-XXXX (e.g., TUPM-21-0001)"
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
  birth_date: z
    .string()
    .min(1, "Please enter your birth date")
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Birth date must be a valid date"
    ),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Password change validation.
 * Enforces strong passwords per Philippine NPC advisory:
 * - Minimum 8 characters
 * - At least 1 uppercase letter
 * - At least 1 number
 * - At least 1 special character
 */
export const passwordChangeSchema = z
  .object({
    old_password: z.string().min(8, "Current password is required"),
    new_password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be at most 72 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number")
      .regex(
        /[^a-zA-Z0-9]/,
        "Must contain at least one special character (!@#$%^&*)"
      ),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  })
  .refine((data) => data.old_password !== data.new_password, {
    message: "New password must be different from current password",
    path: ["new_password"],
  });

export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
