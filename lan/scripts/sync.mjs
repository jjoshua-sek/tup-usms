#!/usr/bin/env node
// The five-minute copy: cloud → STARS offline LAN copy.
//
//   node lan/scripts/sync.mjs --once   copy now
//   node lan/scripts/sync.mjs --loop   copy now, then every SYNC_EVERY_MINUTES
//
// Runs in the `sync` container (lan/sync.Dockerfile), which has pg_dump and
// psql. One-way only: the cloud is the official record, and every refresh
// replaces the LAN copy's data with the cloud's.
//
//   1. Every public table's rows, dumped from the cloud.
//   2. Accounts: staff keep their password hash so they sign in as usual;
//      students are copied without one, so they cannot sign in offline.
//      Accounts are updated in place, not re-created, so a staff member
//      signed in to the LAN copy is not signed out by every refresh.
//   3. Loaded in ONE transaction: STARS shows the old copy until the new one
//      is complete, never a half-copied database.
//   4. Student photos, only those new or changed since the last refresh.
//
// Every run records its outcome in offline_sync_state, which the offline
// banner reads ("records as of 10:42 AM"; red after an hour).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupIfDue } from "./backup.mjs";

const env = process.env;
const EVERY_MS = Math.max(1, Number(env.SYNC_EVERY_MINUTES || 5)) * 60_000;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "stars-sync-"));
const PHOTO_BUCKET = "student-photos";

/** The only columns copied from auth.users and auth.identities. Naming
 * them keeps the copy working when the cloud and the LAN run different
 * versions of Supabase Auth with slightly different tables. */
const USER_COLUMNS = [
  "instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at",
  "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "created_at", "updated_at", "banned_until",
];
const IDENTITY_COLUMNS = ["provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id"];

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

function sh(cmd, args, { input, label } = {}) {
  const result = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = (result.stderr || result.error?.message || "").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${label ?? cmd} failed: ${detail}`);
  }
  return result.stdout;
}

const lanSql = (sql, label) => sh("psql", [env.LAN_DB_URL, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { label });

function recordOutcome({ ok, rows, error }) {
  const quote = (s) => (s === null || s === undefined ? "NULL" : `'${String(s).replace(/'/g, "''").slice(0, 500)}'`);
  lanSql(
    ok
      ? `UPDATE public.offline_sync_state SET last_success_at = NOW(), last_attempt_at = NOW(), last_error = NULL, rows_copied = ${rows} WHERE id = 1;`
      : `UPDATE public.offline_sync_state SET last_attempt_at = NOW(), last_error = ${quote(error)} WHERE id = 1;`,
    "recording the outcome",
  );
}

/** The cloud project's reference, from the pooler user "postgres.<ref>". */
function cloudRef() {
  const user = decodeURIComponent(new URL(env.CLOUD_DB_URL).username);
  return user.includes(".") ? user.split(".").slice(1).join(".") : null;
}

function copyDatabase() {
  const dump = path.join(WORK, "public.sql");
  const users = path.join(WORK, "users.csv");
  const identities = path.join(WORK, "identities.csv");

  // 1. The public tables' rows, as COPY blocks.
  sh("pg_dump", [env.CLOUD_DB_URL, "--data-only", "--schema=public", "--no-owner", "--no-privileges", "--file", dump], {
    label: "pg_dump from the cloud",
  });

  // 2. Accounts. Only staff (a row in public.staff) keep a password hash.
  const userSelect = USER_COLUMNS.map((c) =>
    c === "encrypted_password"
      ? "CASE WHEN EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = u.id) THEN u.encrypted_password ELSE NULL END"
      : `u.${c}`,
  ).join(", ");
  sh("psql", [env.CLOUD_DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `\\copy (SELECT ${userSelect} FROM auth.users u) TO '${users}' CSV`], {
    label: "reading accounts from the cloud",
  });
  sh("psql", [env.CLOUD_DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", `\\copy (SELECT ${IDENTITY_COLUMNS.join(", ")} FROM auth.identities) TO '${identities}' CSV`], {
    label: "reading sign-in identities from the cloud",
  });

  const lanPublicUrl = env.LAN_PUBLIC_URL.replace(/\/$/, "");
  const userUpdates = USER_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const identityUpdates = IDENTITY_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = EXCLUDED.${c}`).join(", ");

  // 3. One transaction: clear the copied tables, load, fix up, commit.
  const load = path.join(WORK, "load.sql");
  fs.writeFileSync(
    load,
    `
-- Rows arrive in dump order, not dependency order: skip triggers and
-- foreign-key checks while loading (they held in the cloud already).
SET session_replication_role = replica;

DO $$
DECLARE tables TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> 'offline_sync_state';
  IF tables IS NOT NULL THEN EXECUTE 'TRUNCATE ' || tables || ' CASCADE'; END IF;
END $$;

\\i ${dump}

CREATE TEMP TABLE incoming_users (LIKE auth.users INCLUDING DEFAULTS) ON COMMIT DROP;
\\copy incoming_users (${USER_COLUMNS.join(", ")}) FROM '${users}' CSV
INSERT INTO auth.users (${USER_COLUMNS.join(", ")})
  SELECT ${USER_COLUMNS.join(", ")} FROM incoming_users
  ON CONFLICT (id) DO UPDATE SET ${userUpdates};
DELETE FROM auth.users WHERE id NOT IN (SELECT id FROM incoming_users);

CREATE TEMP TABLE incoming_identities (LIKE auth.identities INCLUDING DEFAULTS) ON COMMIT DROP;
\\copy incoming_identities (${IDENTITY_COLUMNS.join(", ")}) FROM '${identities}' CSV
INSERT INTO auth.identities (${IDENTITY_COLUMNS.join(", ")})
  SELECT ${IDENTITY_COLUMNS.join(", ")} FROM incoming_identities
  ON CONFLICT (id) DO UPDATE SET ${identityUpdates};
DELETE FROM auth.identities WHERE id NOT IN (SELECT id FROM incoming_identities);

-- Photos are served by the LAN copy's own storage, at its own address.
UPDATE public.students
   SET photo_url = regexp_replace(photo_url, '^https://[^/]+\\.supabase\\.co', '${lanPublicUrl.replace(/'/g, "''")}')
 WHERE photo_url ~ '^https://[^/]+\\.supabase\\.co/';

SET session_replication_role = DEFAULT;
`,
  );
  sh("psql", [env.LAN_DB_URL, "-X", "-q", "-1", "-v", "ON_ERROR_STOP=1", "-f", load], { label: "loading into the LAN copy" });

  const rows = Number(
    lanSql(
      "SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables WHERE schemaname = 'public';",
      "counting rows",
    ).trim() || 0,
  );
  return rows;
}

async function copyPhotos() {
  const ref = cloudRef();
  if (!ref) return 0;
  const cloudStorage = `https://${ref}.supabase.co/storage/v1`;
  const lanHeaders = { Authorization: `Bearer ${env.LAN_SERVICE_ROLE_KEY}`, apikey: env.LAN_SERVICE_ROLE_KEY };

  const cloudBucket = sh("psql", [env.CLOUD_DB_URL, "-X", "-q", "-t", "-A", "-c", `SELECT public FROM storage.buckets WHERE id = '${PHOTO_BUCKET}';`], {
    label: "reading the photo bucket",
  }).trim();
  if (!cloudBucket) return 0;
  const isPublic = cloudBucket === "t";

  // The bucket itself: created on the LAN with the cloud's visibility.
  await fetch(`${env.LAN_API_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...lanHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ id: PHOTO_BUCKET, name: PHOTO_BUCKET, public: isPublic, file_size_limit: 5 * 1024 * 1024 }),
  }); // 400/409 when it already exists: fine

  const list = (url, label) =>
    sh("psql", [url, "-X", "-q", "-t", "-A", "-F", "\t", "-c", `SELECT name, COALESCE(metadata->>'eTag', updated_at::text) FROM storage.objects WHERE bucket_id = '${PHOTO_BUCKET}';`], { label })
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
  const lanHave = new Map(list(env.LAN_DB_URL, "listing LAN photos"));
  const cloudHave = list(env.CLOUD_DB_URL, "listing cloud photos");

  // A changed photo has a new eTag in the cloud; the LAN copy remembers the
  // cloud's eTag in its own object metadata (x-cloud-etag), set below.
  const lanEtags = new Map(
    sh("psql", [env.LAN_DB_URL, "-X", "-q", "-t", "-A", "-F", "\t", "-c", `SELECT name, user_metadata->>'cloudEtag' FROM storage.objects WHERE bucket_id = '${PHOTO_BUCKET}';`], { label: "reading LAN photo tags" })
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t")),
  );

  let copied = 0;
  for (const [name, etag] of cloudHave) {
    if (lanHave.has(name) && lanEtags.get(name) === etag) continue;
    const source = isPublic
      ? `${cloudStorage}/object/public/${PHOTO_BUCKET}/${encodeURI(name)}`
      : null;
    if (!source) continue; // a private bucket would need the cloud key; STARS' photo bucket is public
    const response = await fetch(source);
    if (!response.ok) {
      log(`photo ${name}: cloud answered ${response.status}, skipped`);
      continue;
    }
    const body = Buffer.from(await response.arrayBuffer());
    const form = new FormData();
    form.append("metadata", JSON.stringify({ cloudEtag: etag }));
    form.append("", new Blob([body], { type: response.headers.get("content-type") ?? "image/jpeg" }), name.split("/").pop());
    const upload = await fetch(`${env.LAN_API_URL}/storage/v1/object/${PHOTO_BUCKET}/${encodeURI(name)}`, {
      method: "POST",
      headers: { ...lanHeaders, "x-upsert": "true" },
      body: form,
    });
    if (!upload.ok) {
      log(`photo ${name}: LAN storage answered ${upload.status} ${(await upload.text()).slice(0, 120)}`);
      continue;
    }
    copied += 1;
  }
  return copied;
}

async function runOnce() {
  const started = Date.now();
  if (!env.CLOUD_DB_URL) {
    const error = "CLOUD_DB_URL is not set in lan/.env, so nothing can be copied.";
    log(error);
    try {
      recordOutcome({ ok: false, error });
    } catch (recordError) {
      // Before the first `migrate` there is no state table yet.
      log("could not record it:", recordError.message);
    }
    return false;
  }
  try {
    const rows = copyDatabase();
    let photos = 0;
    try {
      photos = await copyPhotos();
    } catch (error) {
      // Records still count as refreshed; photos catch up next time.
      log("photos not copied this time:", error.message);
    }
    recordOutcome({ ok: true, rows });
    log(`copied ${rows} rows and ${photos} new photo(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    return true;
  } catch (error) {
    // Most often the internet is down: the LAN copy keeps the last good data.
    log("copy failed:", error.message);
    try {
      recordOutcome({ ok: false, error: error.message });
    } catch (recordError) {
      log("could not record the failure:", recordError.message);
    }
    return false;
  } finally {
    for (const file of fs.readdirSync(WORK)) fs.rmSync(path.join(WORK, file), { force: true });
  }
}

if (process.argv.includes("--loop")) {
  log(`copying from the cloud every ${EVERY_MS / 60_000} minute(s)`);
  // Never two copies at once: the next one waits for this one to finish.
  for (;;) {
    await runOnce();
    try {
      const backup = backupIfDue();
      if (backup) log(`nightly backup written: ${path.basename(backup.file)}`);
    } catch (error) {
      log("nightly backup failed:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
} else {
  process.exit((await runOnce()) ? 0 : 1);
}
