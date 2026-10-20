#!/usr/bin/env node
// Encrypted backup of the STARS offline LAN copy's database.
//
//   node lan/scripts/backup.mjs        back up now (inside the sync container;
//                                       `node lan/stars.mjs backup` runs it)
//   import { backupIfDue } …           the nightly run, called by sync.mjs
//
// The copy holds every student's records, so each backup is encrypted with
// BACKUP_PASSPHRASE (made by lan/setup.mjs and kept in lan/.env). Without the
// passphrase a backup cannot be opened: store it somewhere safe, away from
// this machine. Files land in lan/backups; the last 14 are kept.
//
// To restore (lan/README.md has the full steps):
//   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in FILE | pg_restore …
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = process.env.BACKUP_DIR_IN_CONTAINER || "/backups";
const KEEP = 14;
const NIGHTLY_HOUR = 2; // 2 AM, Manila time

const manilaNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const stamp = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

export function backupNow() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) throw new Error("BACKUP_PASSPHRASE is not set in lan/.env; refusing to write an unencrypted backup.");
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `stars-lan-${stamp(manilaNow())}.dump.enc`);

  // pg_dump's custom format, piped straight into openssl: the unencrypted
  // dump never touches the disk.
  const result = spawnSync(
    "sh",
    ["-c", `pg_dump "$LAN_DB_URL" --format=custom --no-owner | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "${file}"`],
    { encoding: "utf8", env: process.env },
  );
  if (result.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.rmSync(file, { force: true });
    throw new Error(`backup failed: ${(result.stderr || "").trim().slice(-300)}`);
  }

  const backups = fs.readdirSync(DIR).filter((f) => /^stars-lan-.+\.dump\.enc$/.test(f)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) fs.rmSync(path.join(DIR, old));
  return { file, bytes: fs.statSync(file).size };
}

/** The nightly backup: once a day, the first time the copy loop runs after 2 AM. */
export function backupIfDue() {
  const now = manilaNow();
  if (now.getHours() < NIGHTLY_HOUR) return null;
  const today = stamp(now).slice(0, 10);
  const done = fs.existsSync(DIR) && fs.readdirSync(DIR).some((f) => f.startsWith(`stars-lan-${today}_`));
  return done ? null : backupNow();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { file, bytes } = backupNow();
    console.log(`✓ Backup written: lan/backups/${path.basename(file)} (${(bytes / 1024 / 1024).toFixed(1)} MB, encrypted)`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
