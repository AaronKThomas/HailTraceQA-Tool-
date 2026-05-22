// File-backed account repository.
//
// Hides the on-disk JSON layout behind a small interface (read, write,
// readNormalized, assertSchema). Routes never touch fs directly. This is the
// seam to swap in a real database later without changing route code.

import fs from "node:fs/promises";
import path from "node:path";

export function createAccountRepository({ dataDir }) {
  const accountsFile = path.join(dataDir, "accounts.json");

  async function ensureDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  async function read() {
    await ensureDir();
    try {
      const raw = await fs.readFile(accountsFile, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async function write(accounts) {
    await ensureDir();
    await fs.writeFile(accountsFile, JSON.stringify(accounts, null, 2));
  }

  async function readNormalized() {
    return (await read()).map(normalize);
  }

  // Refuse to start if the on-disk schema is missing the `email` field.
  // Older snapshots used `username`; the migration script documents the path.
  async function assertSchema() {
    const accounts = await read();
    if (accounts.length === 0) return;
    const offenders = accounts.filter((account) => !account || typeof account !== "object" || !account.email);
    if (offenders.length > 0) {
      console.error(
        "[startup] data/accounts.json contains accounts without an `email` field. "
        + "Run: node scripts/migrate-accounts-to-email.mjs --map \"<oldUsername>=<email>\" "
        + "and restart. Refusing to start.",
      );
      process.exit(1);
    }
  }

  return { read, write, readNormalized, assertSchema, ensureDir };
}

export function normalize(account) {
  return {
    email: String(account.email || "").trim().toLowerCase(),
    displayName: String(account.displayName || "").trim(),
    registeredAt: account.registeredAt,
    role: account.role === "admin" ? "admin" : "tester",
    passwordHash: account.passwordHash || "",
    passwordSalt: account.passwordSalt || "",
    status: account.status === "pending" ? "pending" : "active",
    sessionVersion: Number.isInteger(account.sessionVersion) ? account.sessionVersion : 0,
    pendingToken: account.pendingToken && typeof account.pendingToken === "object" ? account.pendingToken : null,
  };
}

export function sanitize(account) {
  return {
    email: account.email,
    displayName: account.displayName,
    registeredAt: account.registeredAt,
    role: account.role || "tester",
    status: account.status || "active",
  };
}

export function findByEmail(accounts, email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  return accounts.find((account) => String(account.email || "").toLowerCase() === needle) || null;
}
