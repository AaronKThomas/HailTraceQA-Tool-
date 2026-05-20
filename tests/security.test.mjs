import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionCookie,
  hashPassword,
  readSessionCookie,
  validateDisplayName,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../server/security.mjs";
import {
  formatJiraTicketDescription,
  parseJiraKey,
  shouldLoadJiraTicket,
} from "../server/jiraKey.mjs";

test("hashPassword and verifyPassword round-trip correctly", async () => {
  const password = "CorrectHorseBatteryStaple!";
  const hashed = await hashPassword(password);

  assert.ok(hashed.passwordHash);
  assert.ok(hashed.passwordSalt);
  assert.equal(await verifyPassword(password, hashed), true);
  assert.equal(await verifyPassword("wrong-password", hashed), false);
});

test("session cookie signing rejects tampered values", () => {
  const secret = "test-secret";
  const account = {
    username: "alice",
    displayName: "Alice",
    role: "admin",
  };

  const cookie = createSessionCookie(secret, account, Date.now());
  const session = readSessionCookie(secret, cookie);
  assert.equal(session.username, "alice");
  assert.equal(session.role, "admin");

  const [payload, signature] = cookie.split(".");
  const tamperedPayload = `${payload}x.${signature}`;
  assert.equal(readSessionCookie(secret, tamperedPayload), null);
});

test("input validators accept safe values and reject weak ones", () => {
  assert.equal(validateUsername("qa-user_1"), "qa-user_1");
  assert.equal(validateDisplayName("QA Team"), "QA Team");
  assert.equal(validatePassword("LongEnoughPass1!"), "LongEnoughPass1!");

  assert.throws(() => validateUsername("bad user"), /Username may only contain/);
  assert.throws(() => validatePassword("short"), /Password must be between 12 and 128 characters/);
  assert.throws(() => validateDisplayName(" "), /Display name must be between/);
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
