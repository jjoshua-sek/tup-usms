import { describe, expect, it } from "vitest";

import { invitationEmail } from "./invitations";

const email = invitationEmail({
  firstName: "Juan",
  studentNumber: "TUPM-99-0001",
  confirmPath: "/auth/confirm?token_hash=abc123&type=magiclink",
  appUrl: "https://tup-usms.vercel.app/",
});

describe("invitationEmail", () => {
  it("links to this site's confirm route, absolutely", () => {
    expect(email.text).toContain("https://tup-usms.vercel.app/auth/confirm?token_hash=abc123&type=magiclink");
    // The ampersand is escaped inside the HTML attribute, as it must be.
    expect(email.html).toContain("/auth/confirm?token_hash=abc123&amp;type=magiclink");
  });

  it("tells the student their login and where to use it", () => {
    expect(email.text).toContain("TUPM-99-0001");
    expect(email.text).toContain("https://tup-usms.vercel.app/login");
  });

  // Invitations go to the personal address on the enrollment list; the
  // shared footer must not claim otherwise.
  it("says it was sent to the personal address", () => {
    expect(email.text).toMatch(/personal address on your enrollment record/);
    expect(email.text).not.toMatch(/institutional address/);
  });

  it("never points the button off-site, whatever path it is handed", () => {
    const hostile = invitationEmail({
      firstName: "Juan",
      studentNumber: "TUPM-99-0001",
      confirmPath: "https://evil.example/steal",
      appUrl: "https://tup-usms.vercel.app",
    });
    expect(hostile.html).not.toContain("evil.example");
  });
});
