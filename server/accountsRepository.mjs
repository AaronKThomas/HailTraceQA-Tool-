// File-backed account repository.
//
// Routes ask for account lifecycle operations; this module owns the JSON layout,
// normalization, and mutation rules. That keeps auth and invite/reset handlers
// from repeating read-map-write mechanics or token/session invariants.

import fs from "node:fs/promises";
import path from "node:path";

import { verifyToken } from "./tokens.mjs";

class AccountRepositoryError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function accountError(statusCode, message) {
  return new AccountRepositoryError(statusCode, message);
}

function nowIso() {
  return new Date().toISOString();
}

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

  async function getByEmail(email) {
    return findByEmail(await readNormalized(), email);
  }

  async function listSanitized() {
    return (await readNormalized()).map(sanitize);
  }

  async function createRegisteredAccount({ email, displayName, passwordData, actor }) {
    const list = await readNormalized();
    const isBootstrap = list.length === 0;

    if (!isBootstrap) {
      if (!actor?.email) {
        throw accountError(401, "An authenticated admin must create new users.");
      }
      if (actor.role !== "admin") {
        throw accountError(403, "Only admins can create users.");
      }
    }

    if (findByEmail(list, email)) {
      throw accountError(409, "Email already registered.");
    }

    const account = {
      email,
      displayName,
      role: isBootstrap ? "admin" : "tester",
      status: "active",
      sessionVersion: 0,
      pendingToken: null,
      ...passwordData,
      registeredAt: nowIso(),
    };

    await write([...list, account]);
    return { account, isBootstrap };
  }

  async function issueInvite({ email, displayName, tokenRecord, send }) {
    const list = await readNormalized();
    const existing = findByEmail(list, email);
    if (existing && existing.status === "active") {
      throw accountError(409, "An active account already exists for this email.");
    }

    const nextAccount = existing
      ? {
        ...existing,
        displayName,
        pendingToken: tokenRecord,
      }
      : {
        email,
        displayName,
        role: "tester",
        status: "pending",
        sessionVersion: 0,
        pendingToken: tokenRecord,
        passwordHash: "",
        passwordSalt: "",
        registeredAt: nowIso(),
      };

    // Preserve fail-closed invite semantics: a pending account is written only
    // after the mail provider accepts the message containing the raw token.
    await send(nextAccount);

    const nextList = existing
      ? list.map((account) => account.email === existing.email ? nextAccount : account)
      : [...list, nextAccount];
    await write(nextList);

    return nextAccount;
  }

  async function findByRawToken(rawToken, expectedPurpose) {
    const list = await readNormalized();
    return list.find((account) => verifyToken(rawToken, account.pendingToken, expectedPurpose)) || null;
  }

  async function consumeInvite({ rawToken, passwordData, displayName }) {
    const list = await readNormalized();
    const match = list.find((account) => verifyToken(rawToken, account.pendingToken, "invite"));
    if (!match) {
      throw accountError(400, "This invite link is invalid or has expired.");
    }

    const updated = {
      ...match,
      ...passwordData,
      status: "active",
      pendingToken: null,
      displayName: displayName || match.displayName,
      sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
    };

    await write(list.map((account) => account.email === match.email ? updated : account));
    return updated;
  }

  async function issuePasswordReset({ email, tokenRecord }) {
    const list = await readNormalized();
    const match = findByEmail(list, email);
    if (!match || match.status !== "active") return null;

    const updated = { ...match, pendingToken: tokenRecord };
    await write(list.map((account) => account.email === match.email ? updated : account));
    return updated;
  }

  async function rotatePasswordWithResetToken({ rawToken, passwordData }) {
    const list = await readNormalized();
    const match = list.find((account) => verifyToken(rawToken, account.pendingToken, "reset"));
    if (!match) {
      throw accountError(400, "This reset link is invalid or has expired.");
    }

    const updated = {
      ...match,
      ...passwordData,
      pendingToken: null,
      // Bumping sessionVersion invalidates every existing cookie for this account
      // on the next request, including any stolen session.
      sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
    };

    await write(list.map((account) => account.email === match.email ? updated : account));
    return updated;
  }

  async function deleteAccount(email) {
    const list = await readNormalized();
    const target = findByEmail(list, email);
    if (!target) {
      throw accountError(404, "Account not found.");
    }

    if (target.role === "admin") {
      const adminCount = list.filter((account) => account.role === "admin").length;
      if (adminCount <= 1) {
        throw accountError(400, "Cannot remove the last admin account.");
      }
    }

    await write(list.filter((account) => account.email !== target.email));
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

  return {
    read,
    write,
    readNormalized,
    assertSchema,
    ensureDir,
    getByEmail,
    listSanitized,
    createRegisteredAccount,
    issueInvite,
    findByRawToken,
    consumeInvite,
    issuePasswordReset,
    rotatePasswordWithResetToken,
    deleteAccount,
  };
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
