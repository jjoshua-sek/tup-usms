import { describe, expect, it } from "vitest";

import { absoluteActionUrl, escapeHtml, renderNotificationEmail } from "./template";

const APP = "https://tup-usms.vercel.app";

const summons = {
  title: "You have a meeting with the Office of Student Affairs",
  body: "24 September 2026, 9:00 AM at the OSA Office, regarding case OSA-2026-0041.",
  actionUrl: "/appointments",
  actionLabel: "View and acknowledge",
  priority: "high",
  appUrl: APP,
};

describe("escapeHtml", () => {
  it("neutralises markup", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });
});

describe("absoluteActionUrl", () => {
  it("joins a stored path onto the app origin", () => {
    expect(absoluteActionUrl("/violations", APP)).toBe(`${APP}/violations`);
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(absoluteActionUrl("/violations", `${APP}/`)).toBe(`${APP}/violations`);
  });

  // A notification row is staff-authored data, not a trusted source of
  // outbound links. An email that can be steered anywhere is a phishing
  // vector carrying a university's letterhead.
  it("refuses anything that is not a same-origin path", () => {
    expect(absoluteActionUrl("https://evil.example/login", APP)).toBeNull();
    expect(absoluteActionUrl("//evil.example/login", APP)).toBeNull();
    expect(absoluteActionUrl("javascript:alert(1)", APP)).toBeNull();
    expect(absoluteActionUrl(null, APP)).toBeNull();
  });
});

describe("renderNotificationEmail", () => {
  it("carries the title, body and an absolute link", () => {
    const email = renderNotificationEmail(summons);

    expect(email.subject).toBe(summons.title);
    expect(email.html).toContain("OSA-2026-0041");
    expect(email.html).toContain(`${APP}/appointments`);
    expect(email.html).toContain("View and acknowledge");
  });

  it("always produces a plaintext alternative", () => {
    const email = renderNotificationEmail(summons);

    expect(email.text).toContain(summons.body);
    expect(email.text).toContain(`${APP}/appointments`);
    expect(email.text).not.toContain("<td");
  });

  it("escapes staff-authored text in the body", () => {
    const email = renderNotificationEmail({
      ...summons,
      body: 'Reason: <img src=x onerror="steal()">',
    });

    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });

  it("renders without a button when there is nowhere to go", () => {
    const email = renderNotificationEmail({ ...summons, actionUrl: null });

    expect(email.html).not.toContain("href=\"https://tup-usms.vercel.app/appointments\"");
    expect(email.text).not.toContain("View and acknowledge");
  });

  it("marks high-priority mail in the body of the message", () => {
    expect(renderNotificationEmail(summons).html).toContain("needs your attention");
    expect(
      renderNotificationEmail({ ...summons, priority: "normal" }).html,
    ).not.toContain("needs your attention");
  });

  it("states truthfully which address the copy was sent to", () => {
    expect(renderNotificationEmail(summons).text).toMatch(/your institutional address/);

    const invitation = renderNotificationEmail({ ...summons, sentTo: "personal" });
    expect(invitation.text).toMatch(/personal address on your enrollment record/);
    expect(invitation.html).not.toMatch(/institutional address/);
  });

  it("names the institution and the privacy contact", () => {
    const email = renderNotificationEmail(summons);

    expect(email.html).toContain("Office of Student Affairs");
    expect(email.html).toContain("dpo@tup.edu.ph");
    expect(email.html).toContain("RA 10173");
  });
});
