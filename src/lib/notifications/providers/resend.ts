/**
 * Resend provider — the path once a sending domain exists.
 *
 * Written now, though nothing selects it yet, so that "switch to a real
 * domain" is genuinely a configuration change rather than a development
 * task with a deadline attached to it.
 *
 * To adopt: register a domain, add the three DNS records Resend supplies,
 * then set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM. If
 * TUP's IT office ever adds SPF/DKIM for tup.edu.ph, the same file sends as
 * osa@tup.edu.ph with no code change at all.
 *
 * Plain fetch rather than the SDK: one HTTP call does not justify a
 * dependency.
 */

import { PermanentDeliveryError, type EmailProvider, type OutgoingEmail } from "./types";

const ENDPOINT = "https://api.resend.com/emails";

export function createResendProvider(config: {
  apiKey: string;
  from: string;
}): EmailProvider {
  return {
    name: "resend",
    deliversExternally: true,
    async send(message: OutgoingEmail) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (response.ok) {
        const payload = (await response.json()) as { id?: string };
        return { id: payload.id ?? "resend-unknown" };
      }

      const detail = await response.text();

      // 4xx other than rate limiting means the request itself is wrong —
      // a bad address, an unverified domain, a revoked key. Retrying an
      // unchanged request against the same refusal just delays the alarm.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new PermanentDeliveryError(`resend ${response.status}: ${detail}`);
      }

      throw new Error(`resend ${response.status}: ${detail}`);
    },
  };
}
