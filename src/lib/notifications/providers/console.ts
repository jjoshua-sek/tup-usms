/**
 * Development provider. Renders the message to the server log and reports
 * success without touching the network.
 *
 * This is the default when EMAIL_PROVIDER is unset, which matters: the
 * normal state of a developer's machine should be that nothing can reach a
 * real student, and that should be true by omission rather than by
 * remembering to configure it.
 */

import { randomUUID } from "crypto";

import type { EmailProvider, OutgoingEmail, SentMessage } from "./types";

export function createConsoleProvider(): EmailProvider {
  return {
    name: "console",
    deliversExternally: false,
    async send(message: OutgoingEmail): Promise<SentMessage> {
      const id = `console-${randomUUID()}`;
      console.info(
        [
          "",
          "──────── email (not sent: console provider) ────────",
          `to:      ${message.to}`,
          `subject: ${message.subject}`,
          "",
          message.text,
          "────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return { id };
    },
  };
}
