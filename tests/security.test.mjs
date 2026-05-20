import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionCookie,
  hashPassword,
  readSessionCookie,
  validateDisplayName,
  validateEmail,
  validatePassword,
  verifyPassword,
} from "../server/security.mjs";
import {
  formatJiraTicketDescription,
  parseJiraKey,
  shouldLoadJiraTicket,
} from "../server/jiraKey.mjs";
import { createToken, hashToken, verifyToken } from "../server/tokens.mjs";

test("hashPassword and verifyPassword round-trip correctly", async () => {
  const password = "CorrectHorseBatteryStaple!";
  const hashed = await hashPassword(password);

  assert.ok(hashed.passwordHash);
  assert.ok(hashed.passwordSalt);
  assert.equal(await verifyPassword(password, hashed), true);
  assert.equal(await verifyPassword("wrong-password", hashed), false);
});

test("session cookie signing rejects tampered values and embeds sessionVersion", () => {
  const secret = "test-secret";
  const account = {
    email: "alice@example.com",
    displayName: "Alice",
    role: "admin",
    sessionVersion: 3,
  };

  const cookie = createSessionCookie(secret, account, Date.now());
  const session = readSessionCookie(secret, cookie);
  assert.equal(session.email, "alice@example.com");
  assert.equal(session.role, "admin");
  assert.equal(session.sessionVersion, 3);

  const [payload, signature] = cookie.split(".");
  const tamperedPayload = `${payload}x.${signature}`;
  assert.equal(readSessionCookie(secret, tamperedPayload), null);
});

test("input validators accept safe values and reject weak ones", () => {
  assert.equal(validateEmail("Aaron.Thomas@HailTrace.com"), "aaron.thomas@hailtrace.com");
  assert.equal(validateDisplayName("QA Team"), "QA Team");
  assert.equal(validatePassword("LongEnoughPass1!"), "LongEnoughPass1!");

  assert.throws(() => validateEmail("not-an-email"), /Email must look like/);
  assert.throws(() => validateEmail("missing@tld"), /Email must look like/);
  assert.throws(() => validatePassword("short"), /Password must be between 12 and 128 characters/);
  assert.throws(() => validateDisplayName(" "), /Display name must be between/);
});

test("token creation and verification: happy path, wrong purpose, expired, tamper", () => {
  const { raw, record } = createToken("invite");
  assert.equal(record.purpose, "invite");
  assert.equal(record.hash, hashToken(raw));
  assert.equal(verifyToken(raw, record, "invite"), true);
  assert.equal(verifyToken(raw, record, "reset"), false);
  assert.equal(verifyToken("not-the-right-token", record, "invite"), false);

  const expired = { ...record, expiresAt: Date.now() - 1 };
  assert.equal(verifyToken(raw, expired, "invite"), false);

  const tamperedRecord = { ...record, hash: record.hash.slice(0, -2) + "00" };
  assert.equal(verifyToken(raw, tamperedRecord, "invite"), false);
});

test("jira parsing supports bare keys and common Atlassian URLs", () => {
  assert.equal(parseJiraKey("HT-108"), "HT-108");
  assert.equal(parseJiraKey("https://example.atlassian.net/browse/HT-108"), "HT-108");
  assert.equal(parseJiraKey("https://example.atlassian.net/jira/software/c/projects/HT/issues/HT-108"), "HT-108");
  assert.equal(parseJiraKey("https://example.atlassian.net/board?selectedIssue=HT-108"), "HT-108");
  assert.equal(parseJiraKey("not-a-ticket"), null);
});

test("jira loading heuristic only expands key-only inputs", () => {
  assert.equal(shouldLoadJiraTicket("HT-108", "HT-108"), true);
  assert.equal(shouldLoadJiraTicket("https://example.atlassian.net/browse/HT-108", "HT-108"), true);
  assert.equal(shouldLoadJiraTicket("Investigate HT-108 map regression", "HT-108"), false);
});

test("formatJiraTicketDescription includes description and acceptance criteria when present", () => {
  const formatted = formatJiraTicketDescription({
    key: "HT-108",
    summary: "Map should load reports",
    description: "As a user I can view reports.",
    acceptanceCriteria: "Map renders markers.",
  });

  assert.match(formatted, /HT-108: Map should load reports/);
  assert.match(formatted, /Description:/);
  assert.match(formatted, /Acceptance Criteria:/);
});
