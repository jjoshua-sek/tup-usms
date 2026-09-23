/**
 * Checks the mail credentials without deploying anything.
 *
 * A wrong App Password costs a push, a Vercel build, a cron tick and a
 * database query to discover — several minutes to learn one bit of
 * information. This asks smtp.gmail.com the same question directly and
 * answers in about a second.
 *
 *   npm run email:verify              -- log in only, send nothing
 *   npm run email:verify you@mail.com -- log in and send one test message
 *
 * Reads .env.local, so it tests the same values the dev server would use.
 * Set GMAIL_USER and GMAIL_APP_PASSWORD there first.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import nodemailer from "nodemailer";

function loadEnvLocal() {
  const env = {};
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    console.error("No .env.local found. Run this from the project root.");
    process.exit(1);
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnvLocal();
const user = env.GMAIL_USER?.trim();
// Same normalisation the provider applies: Google displays App Passwords in
// four space-separated groups and SMTP wants the sixteen characters bare.
const pass = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");

if (!user || !pass) {
  console.error("GMAIL_USER and GMAIL_APP_PASSWORD must both be set in .env.local.");
  process.exit(1);
}

console.log(`account:  ${user}`);
console.log(`password: ${pass.length} characters after removing spaces`);

if (pass.length !== 16) {
  console.warn(
    `\n⚠  A Google App Password is exactly 16 characters. Yours is ${pass.length}.\n` +
      "   If this is your normal account password, SMTP will always reject it.\n",
  );
}
if (/[^a-z]/.test(pass)) {
  console.warn(
    "⚠  App Passwords are lowercase letters only. Yours contains other characters,\n" +
      "   which suggests it is the account password rather than an App Password.\n",
  );
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log("\n✓ smtp.gmail.com accepted these credentials.");
} catch (error) {
  console.error(`\n✗ Gmail rejected the login: ${error.message}\n`);
  if (/BadCredentials|not accepted|Invalid login/i.test(error.message)) {
    console.error("Almost always one of:");
    console.error("  1. 2-Step Verification is off, so no App Password exists yet");
    console.error("     → https://myaccount.google.com/security");
    console.error("  2. This is the account password, not an App Password");
    console.error("     → https://myaccount.google.com/apppasswords");
    console.error("  3. The App Password belongs to a different Google account");
    console.error("  4. It was revoked — generate a fresh one\n");
  }
  process.exit(1);
}

const recipient = process.argv[2];
if (!recipient) {
  console.log("\nPass an address to also send a test message:");
  console.log("  npm run email:verify -- you@example.com\n");
  process.exit(0);
}

const info = await transporter.sendMail({
  from: env.EMAIL_FROM || `TUP-Manila USMS <${user}>`,
  to: recipient,
  subject: "USMS credential check",
  text: "If you are reading this, the mail credentials work. Nothing else in the system was involved.",
});

console.log(`\n✓ Sent to ${recipient} (message id ${info.messageId})`);
console.log("  Check Spam and Promotions as well as the inbox.");
