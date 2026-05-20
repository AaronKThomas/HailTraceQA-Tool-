// One-shot migration: rename `username` to `email`, drop the legacy plaintext
// `password` field, and add `status` + `sessionVersion` + `pendingToken`.
//
// Usage:
//   node scripts/migrate-accounts-to-email.mjs --dry-run
//   node scripts/migrate-accounts-to-email.mjs --map "Aaron=aaron.thomas@hailtrace.com"
//
// You may pass --map multiple times. Mappings are required for any existing
// account whose `username` is not already a valid email address.
//
// The script is idempotent: running it twice is a no-op. It always snapshots
// the current accounts.json to a timestamped backup before writing.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const accountsPath = path.join(rootDir, "data", "accounts.json");

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function parseArgs(argv) {
  const result = { dryRun: false, mappings: new Map() };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--map") {
      const value = argv[i + 1];
      i += 1;
      if (!value || !value.includes("=")) {
        throw new Error(`--map needs the form "username=email"`);
      }
      const [from, to] = value.split("=");
      if (!from || !to) {
        throw new Error(`--map needs the form "username=email"`);
      }
      result.mappings.set(from.trim(), to.trim().toLowerCase());
    }
  }
  return result;
}

function isValidEmail(value) {
  return typeof value === "string" && EMAIL_REGEX.test(value);
}

async function main() {
  const args = parseArgs(process.argv);

  let raw;
  try {
    raw = await fs.readFile(accountsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("No data/accounts.json found. Nothing to migrate.");
      return;
    }
    throw error;
  }

  const accounts = JSON.parse(raw);
  if (!Array.isArray(accounts)) {
    throw new Error("data/accounts.json is not a JSON array.");
  }

  const migrated = [];
  for (const original of accounts) {
    if (!original || typeof original !== "object") {
      throw new Error("Encountered a non-object entry in accounts.json. Refusing to migrate.");
    }
    const next = { ...original };

    if (!next.email) {
      const username = String(next.username || "").trim();
      if (!username) {
        throw new Error("Encountered an account with neither `email` nor `username`. Refusing to migrate.");
      }
      const mapped = args.mappings.get(username);
      if (mapped && isValidEmail(mapped)) {
        next.email = mapped;
      } else if (isValidEmail(username.toLowerCase())) {
        next.email = username.toLowerCase();
      } else {
        throw new Error(
          `Account "${username}" has no email and no --map was provided. `
          + `Rerun with --map "${username}=name@example.com".`,
        );
      }
      delete next.username;
    } else {
      next.email = String(next.email).toLowerCase();
    }

    if (next.status === undefined) next.status = "active";
    if (!Number.isInteger(next.sessionVersion)) next.sessionVersion = 0;
    if (next.pendingToken === undefined) next.pendingToken = null;

    if ("password" in next) delete next.password;

    migrated.push(next);
  }

  const seen = new Set();
  for (const account of migrated) {
    const key = String(account.email).toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate email after migration: ${key}. Resolve manually before re-running.`);
    }
    seen.add(key);
  }

  if (args.dryRun) {
    console.log("--dry-run set. Result preview:");
    console.log(JSON.stringify(migrated, null, 2));
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${accountsPath}.bak.${timestamp}`;
  await fs.writeFile(backupPath, raw);
  console.log(`Backup written to ${backupPath}`);

  const tmpPath = `${accountsPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(migrated, null, 2));
  await fs.rename(tmpPath, accountsPath);
  console.log(`Migrated ${migrated.length} account(s) in ${accountsPath}.`);
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
