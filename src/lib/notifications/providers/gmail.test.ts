import { describe, expect, it } from "vitest";

import { classifyGmailFailure } from "./gmail";

/** Builds an error shaped the way nodemailer reports SMTP rejections. */
function smtpError(responseCode: number, message: string) {
  return Object.assign(new Error(message), { responseCode });
}

describe("classifyGmailFailure", () => {
  it("treats a bad App Password as ours to fix, not the recipient's", () => {
    expect(
      classifyGmailFailure(smtpError(535, "Invalid login: 535-5.7.8 Username and Password not accepted")),
    ).toBe("auth");
  });

  // The case that matters for bulk enrollment: 5xx by code, but temporary.
  it("treats the daily sending limit as temporary", () => {
    expect(
      classifyGmailFailure(smtpError(550, "550 5.4.5 Daily user sending limit exceeded.")),
    ).toBe("quota");
  });

  it("treats a rejected mailbox as final", () => {
    expect(
      classifyGmailFailure(smtpError(550, "550 5.1.1 The email account that you tried to reach does not exist")),
    ).toBe("recipient");
  });

  it("treats network trouble as transient", () => {
    expect(classifyGmailFailure(new Error("connect ETIMEDOUT"))).toBe("transient");
    expect(classifyGmailFailure(smtpError(421, "421 4.7.0 Try again later"))).toBe("transient");
  });
});
