import { describe, expect, it } from "vitest";

import { receivedVia, referralRationale, staffConcernSchema } from "./intake";

const walkIn = {
  student_number: "tupm-23-5047",
  received_via: "walk_in",
  category: "Personal",
  subject_line: "Needs help with a family emergency",
  body_text: "The student came to the counter worried about a family emergency affecting classes.",
};

describe("staffConcernSchema", () => {
  it("records a walk-in, with the student number normalized", () => {
    const parsed = staffConcernSchema.parse(walkIn);
    expect(parsed.student_number).toBe("TUPM-23-5047");
    expect(parsed.referred_by).toBeNull();
    expect(parsed.follow_up).toBe(false);
  });

  it("needs the faculty member's name for a referral, and keeps the follow-up flag", () => {
    expect(staffConcernSchema.safeParse({ ...walkIn, received_via: "faculty" }).success).toBe(false);
    const parsed = staffConcernSchema.parse({ ...walkIn, received_via: "faculty", referred_by: "Prof. Santos", follow_up: true });
    expect(parsed.referred_by).toBe("Prof. Santos");
    expect(parsed.follow_up).toBe(true);
  });

  it("ignores a referrer and follow-up on anything but a referral", () => {
    const parsed = staffConcernSchema.parse({ ...walkIn, received_via: "letter", referred_by: "Prof. Santos", follow_up: true });
    expect(parsed.referred_by).toBeNull();
    expect(parsed.follow_up).toBe(false);
  });

  it("never lets staff record a concern as the student's own online form", () => {
    expect(staffConcernSchema.safeParse({ ...walkIn, received_via: "online" }).success).toBe(false);
  });

  it("refuses a malformed student number", () => {
    expect(staffConcernSchema.safeParse({ ...walkIn, student_number: "2023-5047" }).success).toBe(false);
  });

  it("never records a complaint against a student: staff file those as cases", () => {
    expect(staffConcernSchema.safeParse({ ...walkIn, category: "Complaint" }).success).toBe(false);
  });
});

describe("receivedVia", () => {
  it("reads rows from before migration 00036 as online", () => {
    expect(receivedVia(undefined)).toBe("online");
    expect(receivedVia("walk_in")).toBe("walk_in");
    expect(receivedVia("carrier pigeon")).toBe("online");
  });
});

describe("referralRationale", () => {
  it("says who referred the student and about what", () => {
    expect(referralRationale("Prof. Santos", "Missing classes")).toContain('Prof. Santos (faculty): "Missing classes"');
  });
});
