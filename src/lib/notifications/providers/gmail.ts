/**
 * Gmail SMTP provider.
 *
 * Chosen as the starting point because it costs nothing and needs no domain:
 * a Google account with 2FA plus an App Password sends up to ~500 messages a
 * day, which comfortably covers a pilot and a defence demonstration.
 *
 * Two limitations worth knowing before this goes in front of real students:
 *
 *  1. Gmail rewrites the From header to the authenticated account. Setting
 *     EMAIL_FROM to something@tup.edu.ph will not make the message appear to
 *     come from there — the display name is the only part under our control.
 *  2. Mail from a gmail.com address carries none of the sending reputation a
 *     verified institutional domain would, so a filter is more likely to
 *     shelve a disciplinary notice as promotional.
 *
 * Both are fixed by the same thing: SPF/DKIM records on a domain we control,
 * at which point this file is replaced by `resend.ts` and nothing else moves.
 */

import nodemailer, { type Transporter } from "nodemailer";

import { PermanentDeliveryError, type EmailProvider, type OutgoingEmail } from "./types";

let transporter: Transporter | null = null;

/**
 * One transport per warm function instance. Fluid Compute reuses instances
 * across requests, so caching this avoids renegotiating TLS with Gmail on
 * every dispatch run.
 */
function getTransport(user: string, pass: string): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
    });
  }
  return transporter;
}

/** Gmail's permanent rejections, which should not be retried. */
function isPermanent(error: unknown): boolean {
  const code = (error as { responseCode?: number } | null)?.responseCode;
  if (typeof code === "number" && code >= 500 && code < 600) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /invalid (recipient|address)|no such user|address rejected/i.test(message);
}

export function createGmailProvider(config: {
  user: string;
  password: string;
  from: string;
}): EmailProvider {
  return {
    name: "gmail",
    deliversExternally: true,
    async send(message: OutgoingEmail) {
      try {
        const info = await getTransport(config.user, config.password).sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return { id: info.messageId };
      } catch (error) {
        if (isPermanent(error)) {
          throw new PermanentDeliveryError(
            error instanceof Error ? error.message : "recipient rejected",
          );
        }
        throw error;
      }
    },
  };
}
