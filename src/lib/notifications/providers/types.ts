/**
 * The seam between "what to say" and "who carries it".
 *
 * Everything above this interface — claiming, policy, templating, backoff —
 * is provider-agnostic. Moving from Gmail SMTP to a verified sending domain
 * later means writing one more file that satisfies `EmailProvider` and
 * changing EMAIL_PROVIDER; no call site, no migration, no template change.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SentMessage {
  /** The provider's own message id, recorded for the delivery audit trail. */
  id: string;
}

export interface EmailProvider {
  /** Stored alongside the message id so the trail says who carried it. */
  readonly name: string;
  /**
   * Whether this provider can actually put mail in someone else's inbox.
   *
   * False for the console provider, which only writes to the server log. The
   * non-production allowlist is skipped for providers that cannot deliver —
   * guarding a provider that reaches nobody blocks every message for no
   * benefit and makes a correctly configured dev machine look broken.
   */
  readonly deliversExternally: boolean;
  send(message: OutgoingEmail): Promise<SentMessage>;
}

/**
 * Thrown for failures the provider considers final — a malformed address, a
 * rejected recipient. The dispatcher stops retrying these immediately
 * instead of working through the full backoff schedule to reach the same
 * rejection five times.
 */
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentDeliveryError";
  }
}
