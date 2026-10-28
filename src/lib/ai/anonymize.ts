/**
 * Strips who a concern is about before its text goes to the AI (the OSA
 * head's review of the checklist, D4: AI summaries are acceptable if
 * anonymized). Pure, so it can be tested; lib/concerns/summarize.ts gathers
 * the names and calls it.
 *
 * Replaced, in this order:
 *   emails            → [email]
 *   student numbers   → [student number]   (TUPM-23-5047 and the like)
 *   PH mobile numbers → [phone]
 *   a title + name    → [name]             (Sir Reyes, Ma'am Joy, Prof. Santos)
 *   known names       → [name]             any capitalised word that is a first
 *                                          or last name of someone in STARS
 *
 * It errs toward removing too much: a student whose name is also a common
 * word ("Joy") loses that word too. A name of someone who is not in STARS
 * and is written without a title can still get through, so the prompt also
 * tells the model to name no one.
 */

export const PLACEHOLDERS = ["[name]", "[student number]", "[email]", "[phone]"] as const;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const STUDENT_NUMBER = /\b[A-Za-z]{3,5}-\d{2}-\d{3,5}\b/g;
const PHONE = /(?:\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const TITLED_NAME =
  /\b(?:Mr|Mrs|Ms|Miss|Sir|Ma['’]?am|Maam|Mam|Prof|Professor|Dr|Engr|Atty|Dean|Coach)\.?\s+[A-ZÑ][\p{L}'’-]+(?:\s+[A-ZÑ][\p{L}'’-]+)?/gu;
const CAPITALISED_WORD = /\b[A-ZÑ][\p{L}'’-]*/gu;

/** Month names double as given names (May, June, April); a date must survive. */
const KEEP = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/**
 * The name tokens to remove, from people's first and last names: each word of
 * three letters or more, lower-cased ("Dela Cruz" gives "dela" and "cruz").
 */
export function nameTokens(people: ReadonlyArray<{ first?: string | null; last?: string | null }>): Set<string> {
  const tokens = new Set<string>();
  for (const person of people) {
    for (const part of [person.first, person.last]) {
      for (const word of (part ?? "").split(/[\s,]+/)) {
        const token = word.trim().toLowerCase();
        if (token.length >= 3 && !KEEP.has(token)) tokens.add(token);
      }
    }
  }
  return tokens;
}

export function anonymizeText(text: string, names: ReadonlySet<string>): string {
  let out = text
    .replace(EMAIL, "[email]")
    .replace(STUDENT_NUMBER, "[student number]")
    .replace(PHONE, "[phone]")
    .replace(TITLED_NAME, "[name]");
  out = out.replace(CAPITALISED_WORD, (word) => (names.has(word.toLowerCase()) ? "[name]" : word));
  // "Juan Dela Cruz" became "[name] [name] [name]": one person, one placeholder.
  return out.replace(/\[name\](?:[\s,]+\[name\])+/g, "[name]");
}
