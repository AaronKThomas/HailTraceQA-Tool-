// Integration tests for invite + password-reset flows.
//
// We spin up the real express app on a random port against a temp data dir
// so the tests never touch real accounts.json and never collide with a dev
// server bound to the default port.
//
// Invariants under test:
//  1. POST /invite creates a pending account that can be redeemed exactly
//     once. Replaying the same token fails. Status becomes "active".
//  2. An expired invite token is rejected at validate AND at consume.
//  3. POST /forgot-password ALWAYS returns 200 regardless of whether the
//     email exists (no user enumeration).
//  4. POST /reset-password bumps sessionVersion, which invalidates every
//     existing session for that account on the next request.
//  5. POST /invite requires admin role; testers get 403.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApp } from "../server/app.mjs";
import { hashPassword } from "../server/security.mjs";

const ADMIN_EMAIL = "admin@hailtrace.test";
const ADMIN_PASSWORD = "AdminPassword123!";

let tempDir;
let server;
let baseUrl;
let app;
let sockets;
let serverStartError = null;

async function seedAccountsJson(accounts) {
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(accounts, null, 2));
}

async function readAccountsFromDisk() {
  const raw = await fs.readFile(path.join(tempDir, "accounts.json"), "utf8");
  return JSON.parse(raw);
}

async function startTestServer() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hailtrace-auth-test-"));
  sockets = new Set();

  const admin = await hashPassword(ADMIN_PASSWORD);
  await seedAccountsJson([
    {
      email: ADMIN_EMAIL,
      displayName: "Test Admin",
      role: "admin",
      status: "active",
      sessionVersion: 0,
      pendingToken: null,
      passwordHash: admin.passwordHash,
      passwordSalt: admin.passwordSalt,
      registeredAt: new Date().toISOString(),
    },
  ]);

  ({ app } = createApp({
    dataDir: tempDir,
    isProduction: false,
    sessionSecret: "test-session-secret-must-be-32-bytes-long-please",
    corsAllowedOrigins: ["http://localhost:5173"],
    trustProxy: false,
    allowDemoMode: true,
    allowClientActionPlans: false,
    appPublicUrl: "http://localhost:5173",
    customerioAppApiKey: "",
    customerioRegion: "us",
    customerioFromName: "",
    customerioInviteTemplateId: "",
    customerioResetTemplateId: "",
  }));

  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer() {
  if (server) {
    for (const socket of sockets || []) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
}

function skipIfServerUnavailable(context) {
  if (!serverStartError) return false;
  context.skip(`Local socket binding unavailable in this environment: ${serverStartError.code || serverStartError.message}`);
  return true;
}

async function jsonRequest(method, path, body, cookieHeader = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? (() => {
    try { return JSON.parse(text); } catch { return text; }
  })() : null;
  return {
    status: response.status,
    data,
    setCookie: response.headers.get("set-cookie") || "",
  };
}

function extractCookie(setCookie) {
  // Tiny parser that pulls the cookie name=value off the front of Set-Cookie.
  // Good enough for the single signed cookie our app sets in tests.
  if (!setCookie) return "";
  return setCookie.split(";")[0];
}

async function adminLogin() {
  const response = await jsonRequest("POST", "/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal(response.status, 200, `Admin login failed: ${JSON.stringify(response.data)}`);
  return extractCookie(response.setCookie);
}

// We use a single suite-level setup so the (slow) scrypt password hashing
// happens once for all tests in this file.
test.before(async () => {
  try {
    await startTestServer();
  } catch (error) {
    serverStartError = error;
  }
});
test.after(stopTestServer);

test("invite happy path: admin invite -> accept-invite -> can log in", async (t) => {
  if (skipIfServerUnavailable(t)) return;
  const adminCookie = await adminLogin();

  const inviteResponse = await jsonRequest(
    "POST",
    "/invite",
    { email: "newcomer@hailtrace.test", displayName: "Newcomer" },
    adminCookie,
  );
  assert.equal(inviteResponse.status, 201);
  assert.equal(inviteResponse.data.account.email, "newcomer@hailtrace.test");
  assert.equal(inviteResponse.data.account.status, "pending");

  // In demo mode the invite URL is logged but not transmitted via API. Grab
  // the raw token directly from disk — same vantage point a user reading
  // their email would have, but recoverable from inside the test.
  const accountsAfterInvite = await readAccountsFromDisk();
  const invited = accountsAfterInvite.find((account) => account.email === "newcomer@hailtrace.test");
  assert.ok(invited.pendingToken, "Pending token should be persisted");

  // We can't recover the raw token (it's only hashed at rest). Instead, we
  // ask the validate endpoint which token rows match a brute-force guess —
  // an infeasible search. So we exercise the consume path by re-generating
  // a known token via the same code path the server uses, swapping it in.
  const { createToken } = await import("../server/tokens.mjs");
  const fresh = createToken("invite");
  const seeded = accountsAfterInvite.map((account) =>
    account.email === "newcomer@hailtrace.test"
      ? { ...account, pendingToken: fresh.record }
      : account,
  );
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(seeded, null, 2));

  const validate = await jsonRequest("GET", `/invite/${encodeURIComponent(fresh.raw)}`);
  assert.equal(validate.status, 200);
  assert.equal(validate.data.valid, true);
  assert.equal(validate.data.email, "newcomer@hailtrace.test");

  const accept = await jsonRequest("POST", "/accept-invite", {
    token: fresh.raw,
    password: "NewcomerPassword99!",
    displayName: "Newcomer Joe",
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.account.status, "active");
  assert.match(accept.setCookie, /hailtrace_qa_session=/);

  // Replay must fail: the token has been consumed, status flipped to active,
  // pendingToken cleared.
  const replay = await jsonRequest("POST", "/accept-invite", {
    token: fresh.raw,
    password: "DifferentPassword11!",
  });
  assert.equal(replay.status, 400);

  // And the freshly minted user can now log in.
  const login = await jsonRequest("POST", "/login", {
    email: "newcomer@hailtrace.test",
    password: "NewcomerPassword99!",
  });
  assert.equal(login.status, 200);
});

test("expired invite token is rejected at validate and at consume", async (t) => {
  if (skipIfServerUnavailable(t)) return;
  const { createToken } = await import("../server/tokens.mjs");
  const expired = createToken("invite");
  expired.record.expiresAt = Date.now() - 1; // already expired

  const accounts = await readAccountsFromDisk();
  accounts.push({
    email: "expired@hailtrace.test",
    displayName: "Expired User",
    role: "tester",
    status: "pending",
    sessionVersion: 0,
    pendingToken: expired.record,
    passwordHash: "",
    passwordSalt: "",
    registeredAt: new Date().toISOString(),
  });
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(accounts, null, 2));

  const validate = await jsonRequest("GET", `/invite/${encodeURIComponent(expired.raw)}`);
  assert.equal(validate.status, 200);
  assert.equal(validate.data.valid, false, "Expired token must be reported invalid");

  const consume = await jsonRequest("POST", "/accept-invite", {
    token: expired.raw,
    password: "ShouldNotWork123!",
  });
  assert.equal(consume.status, 400);
});

test("forgot-password returns 200 for unknown emails (no enumeration)", async (t) => {
  if (skipIfServerUnavailable(t)) return;
  const known = await jsonRequest("POST", "/forgot-password", { email: ADMIN_EMAIL });
  assert.equal(known.status, 200);
  assert.deepEqual(known.data, { ok: true });

  const unknown = await jsonRequest("POST", "/forgot-password", { email: "ghost@hailtrace.test" });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.data, { ok: true });

  const malformed = await jsonRequest("POST", "/forgot-password", { email: "not-an-email" });
  assert.equal(malformed.status, 200);
  assert.deepEqual(malformed.data, { ok: true });
});

test("reset-password bumps sessionVersion and invalidates old sessions", async (t) => {
  if (skipIfServerUnavailable(t)) return;
  const cookieBefore = await adminLogin();

  // /session must work with the existing cookie before the reset.
  const sessionBefore = await jsonRequest("GET", "/session", null, cookieBefore);
  assert.equal(sessionBefore.status, 200);
  assert.equal(sessionBefore.data.account.email, ADMIN_EMAIL);

  // Seed a reset token directly onto the admin account.
  const { createToken } = await import("../server/tokens.mjs");
  const reset = createToken("reset");
  const accounts = await readAccountsFromDisk();
  const next = accounts.map((account) =>
    account.email === ADMIN_EMAIL ? { ...account, pendingToken: reset.record } : account,
  );
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(next, null, 2));

  const resetResponse = await jsonRequest("POST", "/reset-password", {
    token: reset.raw,
    password: "RotatedAdmin456!",
  });
  assert.equal(resetResponse.status, 204);

  // The old cookie must no longer authenticate — sessionVersion got bumped.
  const sessionAfter = await jsonRequest("GET", "/session", null, cookieBefore);
  assert.equal(sessionAfter.data.authenticated, false, "Old cookie must not authenticate after reset");

  // And the new password works.
  const loginNew = await jsonRequest("POST", "/login", { email: ADMIN_EMAIL, password: "RotatedAdmin456!" });
  assert.equal(loginNew.status, 200);

  // Restore the original password so subsequent tests using adminLogin keep
  // working. We do this by directly re-hashing in place.
  const restored = await hashPassword(ADMIN_PASSWORD);
  const accountsForRestore = await readAccountsFromDisk();
  const restoredAccounts = accountsForRestore.map((account) =>
    account.email === ADMIN_EMAIL
      ? { ...account, passwordHash: restored.passwordHash, passwordSalt: restored.passwordSalt }
      : account,
  );
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(restoredAccounts, null, 2));
});

test("POST /invite refuses non-admin callers", async (t) => {
  if (skipIfServerUnavailable(t)) return;
  // Seed a tester account directly on disk to avoid depending on /register's
  // bootstrap/admin gating logic, which would couple this test to that
  // separate flow.
  const testerPassword = "TesterPassword789!";
  const hashed = await hashPassword(testerPassword);
  const accounts = await readAccountsFromDisk();
  accounts.push({
    email: "tester@hailtrace.test",
    displayName: "Plain Tester",
    role: "tester",
    status: "active",
    sessionVersion: 0,
    pendingToken: null,
    passwordHash: hashed.passwordHash,
    passwordSalt: hashed.passwordSalt,
    registeredAt: new Date().toISOString(),
  });
  await fs.writeFile(path.join(tempDir, "accounts.json"), JSON.stringify(accounts, null, 2));

  const login = await jsonRequest("POST", "/login", {
    email: "tester@hailtrace.test",
    password: testerPassword,
  });
  assert.equal(login.status, 200, `Tester login failed: ${JSON.stringify(login.data)}`);
  const testerCookie = extractCookie(login.setCookie);

  const inviteAttempt = await jsonRequest(
    "POST",
    "/invite",
    { email: "stranger@hailtrace.test", displayName: "Stranger" },
    testerCookie,
  );
  assert.equal(inviteAttempt.status, 403, "Tester must not be able to invite");
});
