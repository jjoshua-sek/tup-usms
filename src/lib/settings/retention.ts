import { z } from "zod";

/**
 * Record retention, as the Data Protection Officer sets it (OSA checklist
 * I4). Stored in system_settings (migration 00047); these defaults apply
 * until it runs, and are the values the team recorded. Pure, so it can be
 * read on any page and tested.
 */

export interface RetentionSettings {
  /** Student records are kept this many years after graduation. */
  recordYears: number;
  /** Gate scan logs are kept this many days. */
  accessLogDays: number;
  /** The DPO's memo or reference for the current values, if one was given. */
  dpoReference: string | null;
}

export const DEFAULT_RETENTION: RetentionSettings = { recordYears: 5, accessLogDays: 180, dpoReference: null };

export const RETENTION_KEYS = {
  recordYears: "record_retention_years",
  accessLogDays: "access_log_retention_days",
  dpoReference: "retention_dpo_reference",
} as const;

/** Rows from system_settings → the settings, falling back to the defaults. */
export function readRetention(rows: ReadonlyArray<{ key: string; value: unknown }> | null | undefined): RetentionSettings {
  const value = (key: string) => rows?.find((row) => row.key === key)?.value;
  const whole = (raw: unknown, fallback: number, min: number, max: number) =>
    typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max ? raw : fallback;
  const reference = value(RETENTION_KEYS.dpoReference);
  return {
    recordYears: whole(value(RETENTION_KEYS.recordYears), DEFAULT_RETENTION.recordYears, 1, 50),
    accessLogDays: whole(value(RETENTION_KEYS.accessLogDays), DEFAULT_RETENTION.accessLogDays, 30, 3650),
    dpoReference: typeof reference === "string" && reference.trim() ? reference.trim() : null,
  };
}

export const retentionSchema = z.object({
  recordYears: z.coerce.number().int("Whole years only.").min(1, "At least 1 year.").max(50, "At most 50 years."),
  accessLogDays: z.coerce.number().int("Whole days only.").min(30, "At least 30 days.").max(3650, "At most 3,650 days (10 years)."),
  dpoReference: z
    .string()
    .trim()
    .min(3, "Give the DPO's memo or reference, so the change can be traced.")
    .max(120),
});

/** "5 years after graduation" / "1 year after graduation". */
export function describeRecordRetention(settings: RetentionSettings): string {
  return `${settings.recordYears} year${settings.recordYears === 1 ? "" : "s"} after graduation`;
}

/** "180 days". */
export function describeAccessLogRetention(settings: RetentionSettings): string {
  return `${new Intl.NumberFormat("en-PH").format(settings.accessLogDays)} days`;
}
