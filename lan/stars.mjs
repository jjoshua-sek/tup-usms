#!/usr/bin/env node
// One command for the STARS offline LAN copy. Run lan/setup.mjs once first.
//
//   node lan/stars.mjs up         start everything (builds STARS the first time)
//   node lan/stars.mjs migrate    create or update the database tables
//   node lan/stars.mjs sync       copy from the cloud now, once
//   node lan/stars.mjs backup     write a backup of the LAN database now
//   node lan/stars.mjs cert       save the root certificate to install on devices
//   node lan/stars.mjs status     what is running
//   node lan/stars.mjs logs [service]
//   node lan/stars.mjs down       stop everything (data is kept)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAN_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.dirname(LAN_DIR);
const SUPABASE_DIR = path.join(LAN_DIR, "supabase");
const MIGRATIONS_DIR = path.join(REPO_DIR, "supabase", "migrations");
const LAN_ONLY_SQL = path.join(LAN_DIR, "sql", "lan-only.sql");

if (!fs.existsSync(path.join(SUPABASE_DIR, ".env"))) {
  console.error("Run setup first:  node lan/setup.mjs --host <address devices will use>");
  process.exit(1);
}

const compose = (args, opts = {}) =>
  spawnSync(
    "docker",
    [
      "compose",
      "--project-directory", SUPABASE_DIR,
      "--env-file", path.join(SUPABASE_DIR, ".env"),
      "--env-file", path.join(LAN_DIR, ".env"),
      "-f", path.join(SUPABASE_DIR, "docker-compose.yml"),
      "-f", path.join(LAN_DIR, "docker-compose.stars.yml"),
      ...args,
    ],
    { stdio: "inherit", ...opts },
  );

const exitOn = (result) => {
  if (result.status !== 0) process.exit(result.status ?? 1);
};

/** Runs SQL inside the database container as the role the cloud SQL editor uses. */
function psql(sql, { role = "postgres", quiet = false } = {}) {
  return spawnSync(
    "docker",
    ["exec", "-i", "supabase-db", "psql", "-U", role, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-f", "-"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", quiet ? "pipe" : "inherit"] },
  );
}

function migrate() {
  // Bookkeeping lives in its own schema, which the cloud never has.
  let result = psql(
    "CREATE SCHEMA IF NOT EXISTS lan_meta;" +
      "CREATE TABLE IF NOT EXISTS lan_meta.migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" +
      "SELECT name FROM lan_meta.migrations;",
  );
  if (result.status !== 0) {
    console.error("Could not reach the database. Is it running?  node lan/stars.mjs up");
    process.exit(1);
  }
  const applied = new Set(result.stdout.split(/\r?\n/).filter(Boolean));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{5}_.+\.sql$/.test(f)).sort();

  let count = 0;
  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    if (applied.has(name)) continue;
    process.stdout.write(`→ ${file} … `);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // One transaction per migration, recorded in the same transaction: a
    // migration either applies whole and is remembered, or not at all.
    result = psql(`BEGIN;\n${sql}\n;INSERT INTO lan_meta.migrations (name) VALUES ('${name}');\nCOMMIT;`, { quiet: true });
    if (result.status !== 0) {
      console.log("failed");
      console.error(result.stderr.trim());
      console.error(`\nStopped at ${file}. Nothing from it was applied. Fix it, then run migrate again.`);
      process.exit(1);
    }
    console.log("done");
    count += 1;
  }

  // The LAN copy's own tables (sync state), as the owner: idempotent.
  result = psql(fs.readFileSync(LAN_ONLY_SQL, "utf8"), { role: "supabase_admin", quiet: true });
  if (result.status !== 0) {
    console.error(result.stderr.trim());
    process.exit(1);
  }
  console.log(count ? `✓ Applied ${count} migration(s).` : "✓ Database already up to date.");
}

function saveCert() {
  const out = path.join(LAN_DIR, "stars-root-ca.crt");
  const result = spawnSync("docker", ["exec", "stars-app", "cat", "/ca-public/root.crt"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.includes("BEGIN CERTIFICATE")) {
    console.error("Caddy has not created its certificate yet. Start everything first:  node lan/stars.mjs up");
    process.exit(1);
  }
  fs.writeFileSync(out, result.stdout);
  console.log(`✓ Saved ${out}\n  Install it once on each OSA PC and phone as a trusted root certificate (lan/README.md).`);
}

const [command = "status", ...rest] = process.argv.slice(2);
switch (command) {
  case "up":
    exitOn(compose(["up", "-d", "--build", "--remove-orphans"]));
    console.log("\n✓ Started. First time? Run:  node lan/stars.mjs migrate");
    break;
  case "down":
    exitOn(compose(["down"]));
    break;
  case "migrate":
    migrate();
    break;
  case "sync":
    exitOn(compose(["exec", "sync", "node", "lan/scripts/sync.mjs", "--once"]));
    break;
  case "backup":
    exitOn(compose(["exec", "sync", "node", "lan/scripts/backup.mjs"]));
    break;
  case "cert":
    saveCert();
    break;
  case "logs":
    compose(["logs", "--tail", "100", "-f", ...rest]);
    break;
  case "status":
    exitOn(compose(["ps", "--format", "table {{.Service}}\t{{.State}}\t{{.Status}}"]));
    break;
  default:
    console.error(`Unknown command "${command}". See the top of lan/stars.mjs.`);
    process.exit(1);
}
