/**
 * Provider selection.
 *
 * Fails closed: an unrecognised or misconfigured provider falls back to the
 * console rather than throwing, because a dispatch run that crashes on
 * startup leaves rows stuck at 'sending' until the reaper frees them, and a
 * logged-but-undelivered summons is easier to notice and recover from than a
 * queue that has quietly stopped moving.
 */

import { createConsoleProvider } from "./console";
import { createGmailProvider } from "./gmail";
import { createResendProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailProvider, OutgoingEmail, SentMessage } from "./types";
export { PermanentDeliveryError } from "./types";

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const choice = (env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  const from = env.EMAIL_FROM?.trim();

  if (choice === "gmail") {
    const user = env.GMAIL_USER?.trim();
    const password = env.GMAIL_APP_PASSWORD?.trim();
    if (!user || !password) {
      console.error(
        "[notifications] EMAIL_PROVIDER=gmail but GMAIL_USER or GMAIL_APP_PASSWORD is unset; falling back to console.",
      );
      return createConsoleProvider();
    }
    // Gmail rewrites From to the authenticated account anyway; the display
    // name is the part worth setting.
    return createGmailProvider({
      user,
      password,
      from: from || `TUP-Manila USMS <${user}>`,
    });
  }

  if (choice === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    if (!apiKey || !from) {
      console.error(
        "[notifications] EMAIL_PROVIDER=resend but RESEND_API_KEY or EMAIL_FROM is unset; falling back to console.",
      );
      return createConsoleProvider();
    }
    return createResendProvider({ apiKey, from });
  }

  return createConsoleProvider();
}

/**
 * Addresses that may be mailed when not running in production.
 *
 * The guard exists because the database holds real-looking student records
 * and the moment delivery works, a restored snapshot or a seeded test run
 * could mail actual people about fabricated disciplinary cases. Production
 * is unrestricted; everywhere else is deny-by-default unless an address is
 * named here.
 */
export function resolveAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] | null {
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return null;

  return (env.EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
}
