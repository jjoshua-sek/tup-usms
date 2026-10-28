import { describe, expect, it } from "vitest";

import { anonymizeText, nameTokens } from "./anonymize";

const names = nameTokens([
  { first: "Juan", last: "Dela Cruz" },
  { first: "Maria Clara", last: "Santos" },
  { first: "May", last: "Reyes" },
]);

describe("nameTokens", () => {
  it("splits first and last names into words of three letters or more", () => {
    expect([...names].sort()).toEqual(["clara", "cruz", "dela", "juan", "maria", "reyes", "santos"]);
  });

  it("keeps month names, which double as given names", () => {
    expect(names.has("may")).toBe(false);
  });
});

describe("anonymizeText", () => {
  it("replaces a known person's full name with one placeholder", () => {
    expect(anonymizeText("Juan Dela Cruz pushed me in the hallway.", names)).toBe("[name] pushed me in the hallway.");
  });

  it("replaces a name written alone or surname first", () => {
    expect(anonymizeText("Santos, Maria Clara keeps texting me. Juan saw it.", names)).toBe(
      "[name] keeps texting me. [name] saw it.",
    );
  });

  it("replaces a titled name even when the person is not in STARS", () => {
    expect(anonymizeText("Sir Villanueva shouted at our class.", names)).toBe("[name] shouted at our class.");
    expect(anonymizeText("I told Ma'am Lopez and Prof. Garcia.", names)).toBe("I told [name] and [name].");
  });

  it("removes student numbers, emails and phone numbers", () => {
    expect(
      anonymizeText("I am TUPM-23-5047, reach me at juan.delacruz@gmail.com or 0917 123 4567.", names),
    ).toBe("I am [student number], reach me at [email] or [phone].");
    expect(anonymizeText("Call +63 917-123-4567.", names)).toBe("Call [phone].");
  });

  it("keeps dates and ordinary words", () => {
    expect(anonymizeText("On May 3 the projector in Room 304 broke.", names)).toBe(
      "On May 3 the projector in Room 304 broke.",
    );
  });

  it("does not touch lower-case words that happen to match a name", () => {
    expect(anonymizeText("the cruz family store", names)).toBe("the cruz family store");
  });
});
