/**
 * The account events a user may see about their own account (Settings →
 * Recent account activity), and how each one reads.
 *
 * The list must match the "users read own account activity" policy on
 * audit_logs (migration 00028): an action missing there is never returned,
 * and one missing here would be returned with no label. activity.test.ts
 * compares the two.
 */
export const ACCOUNT_ACTIVITY_ACTIONS = [
  "login",
  "password_change",
  "account_activated",
  "password_reset_requested",
] as const;

export type AccountActivityAction = (typeof ACCOUNT_ACTIVITY_ACTIONS)[number];

export interface AccountActivityRow {
  action: string;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

function parseDetails(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const value = JSON.parse(details);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** What a "Forgot password?" request did, in the words the owner sees. */
const RESET_OUTCOME: Record<string, string> = {
  queued_reset: "A link was emailed to your personal address",
  queued_setup: "Your setup link was emailed again",
  sent_recently: "Not resent — a link had just been sent",
  already_queued: "A link was already on its way",
  email_mismatch: "No link sent — the email entered didn't match",
};

export function describeActivity(row: AccountActivityRow): { label: string; note: string | null } {
  const details = parseDetails(row.details);

  switch (row.action) {
    case "login":
      return { label: "Signed in", note: null };
    case "password_change":
      return { label: "Password changed", note: "Other devices were signed out" };
    case "account_activated":
      return details.purpose === "reset"
        ? { label: "New password set from a reset link", note: "Other devices were signed out" }
        : { label: "Account set up from a sign-in link", note: null };
    case "password_reset_requested":
      return {
        label: "Password reset requested",
        note: RESET_OUTCOME[String(details.outcome)] ?? "No link sent",
      };
    default:
      return { label: row.action, note: null };
  }
}

/** "Chrome on Windows" from a user-agent header; enough to recognise a device. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent || userAgent === "unknown") return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /SamsungBrowser\//.test(userAgent)
        ? "Samsung Internet"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Chrome\//.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "A browser";

  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /CrOS/.test(userAgent)
            ? "ChromeOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "an unknown system";

  return `${browser} on ${os}`;
}
