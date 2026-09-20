/**
 * TUP institutional QR payload parsing.
 *
 * The QR printed on the physical TUP ID (and mirrored on the Digital ID)
 * encodes the student number and nothing else — for example:
 *
 *   TUPM-22-0148
 *
 * Scanners in the wild are messy, so the parser tolerates:
 *   - lowercase input                      → tupm-22-0148
 *   - spaces instead of hyphens            → TUPM 22 0148
 *   - no campus prefix at all              → 22-0148
 *   - surrounding whitespace / newlines    → keyboard-wedge scanners append \r\n
 *   - a URL or label wrapping the number   → https://tup.edu.ph/id/TUPM-22-0148
 *
 * It deliberately does NOT accept:
 *   - a different campus prefix mapped onto Manila. TUPT-22-0148 (Taguig) is a
 *     different person from TUPM-22-0148, so the prefix is preserved and the
 *     lookup simply finds no Manila student.
 *   - anything with a longer digit run glued to it (e.g. 22-01489), which is a
 *     sign the code is not a student number.
 *
 * Because the payload is not a secret, none of the security lives here.
 * See `decide.ts` for the policy that actually guards the gate.
 */

/** Campus code used when a card omits the prefix. */
export const DEFAULT_CAMPUS_PREFIX = "TUPM";

/**
 * Matches an optional 4-letter campus code, a 2-digit batch year and a
 * 4-digit sequence, separated by hyphens, spaces or nothing at all.
 * The lookarounds stop it from matching inside a longer digit run.
 */
const STUDENT_NUMBER_PATTERN =
  /(?<![A-Z0-9])(?:(TUP[A-Z])[-\s]?)?(\d{2})[-\s]?(\d{4})(?![\dA-Z])/;

export interface ParsedQrPayload {
  ok: boolean;
  /** Canonical form, e.g. "TUPM-22-0148". Null when unparseable. */
  studentNumber: string | null;
  campusPrefix: string | null;
  /** Whether the card carried an explicit campus code. */
  hadPrefix: boolean;
}

export function parseInstitutionalQr(raw: string | null | undefined): ParsedQrPayload {
  const miss: ParsedQrPayload = {
    ok: false,
    studentNumber: null,
    campusPrefix: null,
    hadPrefix: false,
  };

  if (!raw) return miss;

  // Normalize: strip zero-width characters, unify dash variants, uppercase.
  const cleaned = raw
    .replace(/[​-‍﻿]/g, "")
    .replace(/[_–—]/g, "-")
    .trim()
    .toUpperCase();

  if (!cleaned || cleaned.length > 128) return miss;

  const match = cleaned.match(STUDENT_NUMBER_PATTERN);
  if (!match) return miss;

  const [, prefix, batchYear, sequence] = match;
  const campusPrefix = prefix ?? DEFAULT_CAMPUS_PREFIX;

  return {
    ok: true,
    studentNumber: `${campusPrefix}-${batchYear}-${sequence}`,
    campusPrefix,
    hadPrefix: Boolean(prefix),
  };
}

/**
 * The exact string the Digital ID encodes into its QR. Keeping this next to
 * the parser means the two can never drift apart.
 */
export function formatInstitutionalQrPayload(studentNumber: string): string {
  const parsed = parseInstitutionalQr(studentNumber);
  return parsed.studentNumber ?? studentNumber.trim().toUpperCase();
}

/**
 * Partially masks a student number for display on shared screens
 * (kiosk, guard monitor): TUPM-22-0148 → TUPM-22-••48.
 *
 * Data minimization under RA 10173 §11: a bystander at the gate has no need
 * to read a full, transcribable student number off the screen.
 */
export function maskStudentNumber(studentNumber: string | null | undefined): string {
  if (!studentNumber) return "—";
  const parsed = parseInstitutionalQr(studentNumber);
  if (!parsed.studentNumber) return studentNumber;

  const [prefix, batch, sequence] = parsed.studentNumber.split("-");
  return `${prefix}-${batch}-••${sequence.slice(-2)}`;
}

/**
 * "Juan Dela Cruz" → "Juan D." — enough for a guard to match the face on the
 * screen to the person in front of them, without publishing a full name.
 */
export function shortDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (!first && !last) return "Student";
  if (!last) return first;
  return `${first} ${last.charAt(0).toUpperCase()}.`.trim();
}
