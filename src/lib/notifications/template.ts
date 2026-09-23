/**
 * Renders one notification as an email.
 *
 * Pure — no network, no environment reads beyond what the caller passes in —
 * so the output can be asserted in a test rather than eyeballed in an inbox.
 *
 * Deliberately one template for all thirty-one notification types. The rows
 * already carry a title, a body, and a call to action written by the staff
 * action that raised them, so per-type templates would duplicate copy that
 * already exists and drift from it.
 *
 * On confidentiality: the email restates only what the portal notification
 * says, and the call sites keep that deliberately thin — a summons gives the
 * date, the venue and the case number, never the allegation. Institutional
 * mail gets read on shared screens and forwarded without thinking; the
 * substance of a disciplinary matter stays behind the login.
 */

const MAROON = "#7a1f2b";
const GOLD = "#d4a017";
const INK = "#1c1917";
const MUTED = "#6b7280";
const RULE = "#e7e5e4";

export interface EmailTemplateInput {
  title: string;
  body: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  priority?: string | null;
  /** Absolute origin of the portal, e.g. https://tup-usms.vercel.app */
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Escapes text for HTML. Notification bodies are assembled from staff input
 * (rejection reasons, settlement terms, hearing venues), so they are
 * untrusted by the time they reach here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Turns a stored `action_url` into an absolute link.
 *
 * Only same-origin paths are honoured. A stored value that is already
 * absolute is discarded rather than followed — a notification row is not a
 * trustworthy source of outbound links, and an email that can be made to
 * point anywhere is a phishing vector wearing a university's letterhead.
 */
export function absoluteActionUrl(
  actionUrl: string | null | undefined,
  appUrl: string,
): string | null {
  if (!actionUrl) return null;
  const origin = appUrl.replace(/\/+$/, "");
  if (!actionUrl.startsWith("/")) return null;
  if (actionUrl.startsWith("//")) return null;
  return `${origin}${actionUrl}`;
}

export function renderNotificationEmail(input: EmailTemplateInput): RenderedEmail {
  const href = absoluteActionUrl(input.actionUrl, input.appUrl);
  const isUrgent = input.priority === "urgent" || input.priority === "high";
  const label = input.actionLabel?.trim() || "Open the portal";

  const title = escapeHtml(input.title);
  const body = escapeHtml(input.body).replace(/\n/g, "<br />");

  // Table layout and inline styles throughout: Outlook ignores <style>
  // blocks and most layout CSS, and institutional accounts run Outlook.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <tr>
          <td style="background:${MAROON};border-bottom:3px solid ${GOLD};padding:18px 28px;">
            <div style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.02em;">
              Technological University of the Philippines &mdash; Manila
            </div>
            <div style="color:#f4dde0;font-size:12px;margin-top:2px;">
              Office of Student Affairs
            </div>
          </td>
        </tr>

        ${
          isUrgent
            ? `<tr><td style="background:#fbf3f4;border-bottom:1px solid ${RULE};padding:10px 28px;color:${MAROON};font-size:12px;font-weight:600;">This message needs your attention.</td></tr>`
            : ""
        }

        <tr>
          <td style="padding:28px;">
            <h1 style="margin:0 0 12px;font-size:19px;line-height:1.35;color:${INK};font-weight:700;">${title}</h1>
            <p style="margin:0;font-size:14px;line-height:1.65;color:${INK};">${body}</p>

            ${
              href
                ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
                     <tr><td style="background:${MAROON};border-radius:6px;">
                       <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>
                     </td></tr>
                   </table>
                   <p style="margin:14px 0 0;font-size:11px;color:${MUTED};">
                     If the button does not work, paste this into your browser:<br />
                     <span style="color:${MUTED};">${escapeHtml(href)}</span>
                   </p>`
                : ""
            }
          </td>
        </tr>

        <tr>
          <td style="border-top:1px solid ${RULE};padding:18px 28px;">
            <p style="margin:0 0 8px;font-size:11px;line-height:1.6;color:${MUTED};">
              This is an official notice from the TUP-Manila Office of Student Affairs, sent to
              your institutional address. Replies to this message are not read &mdash; use the
              portal, or visit the OSA window, if you need to respond.
            </p>
            <p style="margin:0;font-size:11px;line-height:1.6;color:${MUTED};">
              Your personal data is processed under the Data Privacy Act of 2012 (RA 10173).
              Questions about how your records are handled go to
              <a href="mailto:dpo@tup.edu.ph" style="color:${MAROON};">dpo@tup.edu.ph</a>.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  // Every message carries a plaintext alternative: filters score
  // HTML-only mail worse, and it is what a screen reader reads.
  const text = [
    "TECHNOLOGICAL UNIVERSITY OF THE PHILIPPINES - MANILA",
    "Office of Student Affairs",
    "",
    input.title,
    "",
    input.body,
    ...(href ? ["", `${label}: ${href}`] : []),
    "",
    "---",
    "This is an official notice sent to your institutional address.",
    "Replies are not read - use the portal or visit the OSA window.",
    "Personal data is processed under RA 10173. Queries: dpo@tup.edu.ph",
  ].join("\n");

  return { subject: input.title, html, text };
}
