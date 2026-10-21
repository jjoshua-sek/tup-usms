#!/usr/bin/env node
// Prepares the STARS offline LAN copy on this machine. Run once, from Git Bash
// (or any shell with `sh`, `git` and `openssl`):
//
//   node lan/setup.mjs --host 192.168.137.1
//
// It downloads Supabase's official self-hosting files at a pinned version
// into lan/supabase, generates this install's own secrets and API keys
// (never Supabase's public demo keys: anyone on the network could use those),
// and points everything at the LAN address. Safe to run again: existing
// secrets are kept, only the address is updated.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_DIR = path.join(LAN_DIR, "supabase");
const LAN_ENV = path.join(LAN_DIR, ".env");

/** Supabase's docker/ folder at this commit (2026-10-20). Bump deliberately. */
const SUPABASE_REPO = "https://github.com/supabase/supabase.git";
const SUPABASE_REF = "067050938151be5b66d20d8c4147d27f679a7bf2";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: false, ...opts });
  if (result.status !== 0) {
    console.error(`\n✗ ${cmd} ${cmdArgs.join(" ")} failed (exit ${result.status ?? result.error?.message}).`);
    process.exit(1);
  }
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

/** Sets KEY=value lines in an env file, keeping every other line as it is. */
function setEnv(file, values) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  fs.writeFileSync(file, text);
}

// ---- 1. The LAN address ------------------------------------------------
const existing = readEnv(LAN_ENV);
const host = flag("host") ?? existing.LAN_HOST;
if (!host) {
  console.error(
    "Give the address devices will use, e.g.\n  node lan/setup.mjs --host 192.168.137.1\n" +
      "(192.168.137.1 is this laptop's address when Windows Mobile Hotspot is on.)",
  );
  process.exit(1);
}
const publicUrl = `https://${host}`;

// ---- 2. Supabase's self-hosting files ----------------------------------
if (!fs.existsSync(path.join(SUPABASE_DIR, "docker-compose.yml"))) {
  console.log(`→ Downloading Supabase self-hosting files (${SUPABASE_REF.slice(0, 12)})…`);
  const tmp = fs.mkdtempSync(path.join(LAN_DIR, ".supabase-src-"));
  try {
    run("git", ["init", "-q", tmp]);
    run("git", ["-C", tmp, "remote", "add", "origin", SUPABASE_REPO]);
    run("git", ["-C", tmp, "sparse-checkout", "set", "docker"]);
    run("git", ["-C", tmp, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", SUPABASE_REF]);
    run("git", ["-C", tmp, "checkout", "-q", "FETCH_HEAD"]);
    fs.cpSync(path.join(tmp, "docker"), SUPABASE_DIR, { recursive: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 3. This install's own secrets -------------------------------------
const supabaseEnv = path.join(SUPABASE_DIR, ".env");
if (!fs.existsSync(supabaseEnv)) {
  console.log("→ Generating this install's secrets and API keys…");
  fs.copyFileSync(path.join(SUPABASE_DIR, ".env.example"), supabaseEnv);
  run("sh", ["utils/generate-keys.sh", "--update-env"], { cwd: SUPABASE_DIR });
  run("sh", ["utils/add-new-auth-keys.sh", "--update-env"], { cwd: SUPABASE_DIR });
}

// ---- 4. Point Supabase at the LAN address ------------------------------
setEnv(supabaseEnv, {
  SUPABASE_PUBLIC_URL: publicUrl,
  API_EXTERNAL_URL: publicUrl,
  SITE_URL: publicUrl,
  PROXY_DOMAIN: host,
  // Accounts come from the cloud copy only; nobody signs up on the LAN.
  DISABLE_SIGNUP: "true",
  ENABLE_ANONYMOUS_USERS: "false",
  ENABLE_PHONE_SIGNUP: "false",
  STUDIO_DEFAULT_ORGANIZATION: "TUP-Manila OSA",
  STUDIO_DEFAULT_PROJECT: "STARS offline copy",
});

// ---- 5. STARS' own LAN settings ----------------------------------------
setEnv(LAN_ENV, {
  LAN_HOST: host,
  ...(existing.CLOUD_DB_URL ? {} : { CLOUD_DB_URL: "" }),
  ...(existing.SYNC_EVERY_MINUTES ? {} : { SYNC_EVERY_MINUTES: "5" }),
  // Relative to lan/supabase, the compose project directory.
  ...(existing.BACKUP_DIR ? {} : { BACKUP_DIR: "../backups" }),
  // Encrypts the nightly backups. Store it somewhere safe, away from this
  // machine: without it no backup can be opened.
  ...(existing.BACKUP_PASSPHRASE ? {} : { BACKUP_PASSPHRASE: crypto.randomBytes(24).toString("base64url") }),
  // Phase 2: where the outbox goes once the internet is back, and the key
  // that proves it comes from this copy. Set the same OFFLINE_UPLOAD_KEY in
  // Vercel (Settings → Environment Variables), or uploads are refused.
  ...(existing.CLOUD_APP_URL ? {} : { CLOUD_APP_URL: "https://tup-usms.vercel.app" }),
  ...(existing.OFFLINE_UPLOAD_KEY ? {} : { OFFLINE_UPLOAD_KEY: crypto.randomBytes(32).toString("base64url") }),
});

const missing =
  (readEnv(LAN_ENV).CLOUD_DB_URL
    ? ""
    : "\n  Before the first copy, open lan/.env and set CLOUD_DB_URL to the cloud database's\n" +
      "  Session pooler connection string (Supabase dashboard → Connect → Session pooler).\n") +
  "\n  So offline gate scans and ID validations reach the cloud: copy OFFLINE_UPLOAD_KEY from\n" +
  "  lan/.env into Vercel → Settings → Environment Variables (same name), then redeploy.\n";

console.log(`
✓ Ready. STARS offline copy will answer at ${publicUrl}
${missing}
Next:
  node lan/stars.mjs up        start everything
  node lan/stars.mjs migrate   create the database tables (first time)
  node lan/stars.mjs sync      copy from the cloud now
`);
