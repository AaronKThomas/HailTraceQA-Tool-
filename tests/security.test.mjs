import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCorsOptions,
  createSessionCookie,
  getClientIp,
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
import { createVideoReplayArtifact, getVideoReplayArtifact } from "../server/testArtifacts.mjs";
import { classifyWebsiteQaExecutionError } from "../server/openai.mjs";
import {
  assertSafeWebsiteTarget,
  assertSafeWebsiteUrl,
  extractFirstHttpUrl,
  isBlockedIpAddress,
  isTelemetryRequest,
  normalizeVerdict,
  normalizeWebsiteActionPlan,
  normalizeWebsiteActionPlanWithDefaults,
  redactUrlForLog,
} from "../server/websiteQa.mjs";
import { buildAnalysis, summarizeFindings } from "../server/websiteQa/reporting.mjs";

test("getClientIp ignores spoofable X-Forwarded-For unless a proxy is trusted", () => {
  const req = {
    headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    socket: { remoteAddress: "10.0.0.9" },
  };

  // Default: header is attacker-controllable, so it must be ignored.
  assert.equal(getClientIp(req), "10.0.0.9");
  assert.equal(getClientIp(req, { trustProxy: false }), "10.0.0.9");

  // Behind a trusted proxy: use the last hop (the proxy-appended value).
  assert.equal(getClientIp(req, { trustProxy: true }), "5.6.7.8");

  // No header + trusted proxy still falls back to the socket address.
  assert.equal(
    getClientIp({ headers: {}, socket: { remoteAddress: "10.0.0.9" } }, { trustProxy: true }),
    "10.0.0.9",
  );
});

test("buildCorsOptions fails closed and only allows configured browser origins", () => {
  const allowOrNot = (options, origin) =>
    new Promise((resolve) => options.origin(origin, (err, ok) => resolve(err ? false : ok)));

  const configured = buildCorsOptions(["https://qa.example.com"]);
  assert.equal(configured.credentials, true);

  return Promise.all([
    allowOrNot(configured, "https://qa.example.com"),
    allowOrNot(configured, "https://evil.example.com"),
    allowOrNot(configured, undefined),
    allowOrNot(buildCorsOptions([]), "https://anything.example.com"),
  ]).then(([allowed, blocked, noOrigin, emptyAllowlist]) => {
    assert.equal(allowed, true, "configured origin allowed");
    assert.equal(blocked, false, "unlisted origin blocked");
    assert.equal(noOrigin, true, "non-browser request (no Origin) allowed");
    assert.equal(emptyAllowlist, false, "empty allowlist denies all browser origins (fail closed)");
  });
});

test("assertSafeWebsiteTarget returns the validated public IP and rejects private targets", async () => {
  // Literal IPs keep this deterministic (no DNS). The returned IP is what the
  // runner pins Chromium to, defeating DNS rebinding.
  const target = await assertSafeWebsiteTarget("http://1.1.1.1/path");
  assert.equal(target.ip, "1.1.1.1");
  assert.equal(target.hostname, "1.1.1.1");
  assert.ok(target.url.startsWith("http://1.1.1.1/"));

  await assert.rejects(() => assertSafeWebsiteTarget("http://127.0.0.1/"));
  await assert.rejects(() => assertSafeWebsiteTarget("http://169.254.169.254/"));
  await assert.rejects(() => assertSafeWebsiteTarget("ftp://1.1.1.1/"));
});

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

test("video replay artifacts are owner-scoped and expire", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hailtrace-artifacts-test-"));
  try {
    const sourcePath = path.join(tempDir, "source.webm");
    await fs.writeFile(sourcePath, "fake video");

    const artifact = await createVideoReplayArtifact({
      artifactsDir: path.join(tempDir, "artifacts"),
      ownerEmail: "Tester@HailTrace.test",
      sourcePath,
      retentionMs: 1000,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.ok(artifact.url.startsWith("/test-artifacts/"));

    const resolved = await getVideoReplayArtifact({
      artifactsDir: path.join(tempDir, "artifacts"),
      id: artifact.id,
      ownerEmail: "tester@hailtrace.test",
      now: new Date("2026-01-01T00:00:00.500Z"),
    });
    assert.equal(await fs.readFile(resolved.filePath, "utf8"), "fake video");

    await assert.rejects(
      () => getVideoReplayArtifact({
        artifactsDir: path.join(tempDir, "artifacts"),
        id: artifact.id,
        ownerEmail: "other@hailtrace.test",
        now: new Date("2026-01-01T00:00:00.500Z"),
      }),
      /Artifact not found/,
    );

    await assert.rejects(
      () => getVideoReplayArtifact({
        artifactsDir: path.join(tempDir, "artifacts"),
        id: artifact.id,
        ownerEmail: "tester@hailtrace.test",
        now: new Date("2026-01-01T00:00:02.000Z"),
      }),
      /Artifact not found/,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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

test("website QA URL extraction preserves the first public-looking URL", () => {
  assert.equal(
    extractFirstHttpUrl("Check https://example.com/dashboard, then verify login."),
    "https://example.com/dashboard",
  );
  assert.equal(extractFirstHttpUrl("No URL here"), "");
});

test("website QA blocks local and private network targets", async () => {
  assert.equal(isBlockedIpAddress("127.0.0.1"), true);
  assert.equal(isBlockedIpAddress("10.0.0.5"), true);
  assert.equal(isBlockedIpAddress("172.16.1.10"), true);
  assert.equal(isBlockedIpAddress("192.168.1.20"), true);
  assert.equal(isBlockedIpAddress("169.254.169.254"), true);
  assert.equal(isBlockedIpAddress("::ffff:172.16.0.1"), true);
  assert.equal(isBlockedIpAddress("::ffff:ac10:1"), true);
  assert.equal(isBlockedIpAddress("::ffff:100.64.0.1"), true);
  assert.equal(isBlockedIpAddress("8.8.8.8"), false);
  assert.equal(isBlockedIpAddress("::ffff:8.8.8.8"), false);

  await assert.rejects(
    () => assertSafeWebsiteUrl("http://localhost:5173"),
    /Local hostnames cannot be tested/,
  );
  await assert.rejects(
    () => assertSafeWebsiteUrl("http://127.0.0.1:5173"),
    /Private, local, or reserved IP addresses cannot be tested/,
  );
  await assert.rejects(
    () => assertSafeWebsiteUrl("http://[::1]/"),
    /Private, local, or reserved IP addresses cannot be tested/,
  );
  await assert.rejects(
    () => assertSafeWebsiteUrl("http://[::ffff:172.16.0.1]/"),
    /Private, local, or reserved IP addresses cannot be tested/,
  );
  await assert.rejects(
    () => assertSafeWebsiteUrl("file:///etc/passwd"),
    /Only http:\/\/ and https:\/\//,
  );
});

test("website QA redacts sensitive URL parts before logging", () => {
  assert.equal(
    redactUrlForLog("https://user:pass@example.com/maps/weather-events?token=secret#frag"),
    "https://example.com/maps/weather-events?[redacted]",
  );
});

test("website action plans allow bounded map click and popup assertions", async () => {
  const plan = await normalizeWebsiteActionPlan({
    targetUrl: "http://8.8.8.8/maps?token=secret",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps?token=secret" },
      { action: "clickSelector", selector: "canvas", position: { xRatio: 0.5, yRatio: 0.5 } },
      { action: "expectPopupLikeElement" },
    ],
  });

  assert.equal(plan.requiresAuth, false);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[1].selector, "canvas");
  assert.deepEqual(plan.steps[1].position, { xRatio: 0.5, yRatio: 0.5 });
});

test("website action plans reject dangerous selectors and cross-origin navigation", async () => {
  await assert.rejects(
    () => normalizeWebsiteActionPlan({
      targetUrl: "http://8.8.8.8/",
      steps: [{ action: "clickSelector", selector: "xpath=//button" }],
    }),
    /Selector is not allowed/,
  );

  await assert.rejects(
    () => normalizeWebsiteActionPlan({
      targetUrl: "http://8.8.8.8/",
      steps: [{ action: "navigate", url: "http://1.1.1.1/" }],
    }),
    /may not navigate away/,
  );
});

test("website action plans treat the explicit request URL as the navigation authority", async () => {
  await assert.rejects(
    () => normalizeWebsiteActionPlan({
      targetUrl: "http://1.1.1.1/",
      steps: [{ action: "navigate", url: "http://1.1.1.1/" }],
    }, "Search weather events on http://8.8.8.8/maps"),
    /may not navigate away/,
  );
});

test("website action plans use the configured default URL for prompt-only requests", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults(
    null,
    "search for a weather event",
    { defaultTargetUrl: "http://8.8.8.8/maps" },
  );

  assert.ok(plan);
  assert.equal(plan.targetUrl, "http://8.8.8.8/maps");
  assert.equal(plan.requiresAuth, false);
  assert.equal(plan.steps[0].action, "navigate");
  assert.equal(plan.steps[0].url, "http://8.8.8.8/maps");
  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "fillSearch"],
  );
  assert.equal(plan.steps[1].value, "hail");
});

test("generated HailTrace weather-event search plans select a result and pan the map", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "fillSearch", value: "hail" },
    ],
  }, "search for a weather event", {
    defaultTargetUrl: "http://8.8.8.8/maps",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "fillSearch", "selectCheckbox", "panMap"],
  );
  assert.equal(plan.steps[2].index, 0);
  assert.equal(plan.steps[3].direction, "right");
});

test("website action plans keep model-generated URLs on the configured default origin", async () => {
  await assert.rejects(
    () => normalizeWebsiteActionPlanWithDefaults({
      targetUrl: "http://1.1.1.1/maps",
      requiresAuth: false,
      steps: [{ action: "navigate", url: "http://1.1.1.1/maps" }],
    }, "search for a weather event", { defaultTargetUrl: "http://8.8.8.8/maps" }),
    /may not navigate away/,
  );
});

test("website action plans repair missing generated selectors for default HailTrace search", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "expectVisible", selector: null },
    ],
  }, "search for a weather event", {
    defaultTargetUrl: "http://8.8.8.8/maps",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "fillSearch", "selectCheckbox", "panMap"],
  );
  assert.equal(plan.steps[1].value, "hail");
});

test("website action plans still reject missing selectors outside generated-plan repair", async () => {
  await assert.rejects(
    () => normalizeWebsiteActionPlanWithDefaults({
      targetUrl: "http://8.8.8.8/maps",
      requiresAuth: false,
      steps: [
        { action: "navigate", url: "http://8.8.8.8/maps" },
        { action: "expectVisible", selector: null },
      ],
    }, "search for a weather event", {
      defaultTargetUrl: "http://8.8.8.8/maps",
    }),
    /selector is required/,
  );
});

test("generated website action plans drop selector steps that have no selector", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/assets",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/assets" },
      { action: "expectVisible", selector: null },
    ],
  }, "Testing the population of the assets page", {
    defaultTargetUrl: "http://8.8.8.8/assets",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate"],
  );
});

test("website action plans accept bounded selectCheckbox steps", async () => {
  const plan = await normalizeWebsiteActionPlan({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "selectCheckbox", index: 0 },
    ],
  });

  const checkboxStep = plan.steps.find((step) => step.action === "selectCheckbox");
  assert.ok(checkboxStep);
  assert.equal(checkboxStep.index, 0);
});

test("generated HailTrace download plans select the storm date checkbox", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: true,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "fillSearch", value: "hail" },
      { action: "waitForText", text: "Download" },
    ],
  }, "Download functionality for a weather event on the HailTrace maps page", {
    defaultTargetUrl: "http://8.8.8.8/maps",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "fillSearch", "selectCheckbox"],
  );
  assert.equal(plan.steps[2].index, 0);
});

test("website action plans default selectCheckbox index to 0 and reject out-of-range indexes", async () => {
  const plan = await normalizeWebsiteActionPlan({
    targetUrl: "http://8.8.8.8/maps",
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "selectCheckbox" },
    ],
  });
  assert.equal(plan.steps.find((step) => step.action === "selectCheckbox").index, 0);

  await assert.rejects(
    () => normalizeWebsiteActionPlan({
      targetUrl: "http://8.8.8.8/maps",
      steps: [{ action: "selectCheckbox", index: 9999 }],
    }),
    /Checkbox index must be an integer/,
  );
});

test("telemetry request detection ignores analytics hosts and proxied PostHog, not app traffic", () => {
  assert.equal(isTelemetryRequest("https://analytics.google.com/g/collect?v=2"), true);
  assert.equal(isTelemetryRequest("https://o47488.ingest.sentry.io/api/1/envelope/"), true);
  assert.equal(isTelemetryRequest("https://app.hailtrace.com/_posthog/flags/?token=x"), true);
  assert.equal(isTelemetryRequest("https://app.hailtrace.com/maps/weather-events"), false);
  assert.equal(isTelemetryRequest("https://app.hailtrace.com/api/events"), false);
});

test("website action plans can be inferred from plain map popup requests", async () => {
  const plan = await normalizeWebsiteActionPlan(null, "Open http://8.8.8.8/maps and select the map, then check that a popup appears.");

  assert.ok(plan);
  assert.equal(plan.targetUrl, "http://8.8.8.8/maps");
  assert.equal(plan.steps.some((step) => step.action === "clickSelector"), true);
  assert.equal(plan.steps.some((step) => step.action === "expectPopupLikeElement"), true);
});

test("website action plans include a real map pan step when requested", async () => {
  const plan = await normalizeWebsiteActionPlan(
    null,
    "Open http://8.8.8.8/maps and pan the map to verify polygons are still visible.",
  );

  const panStep = plan.steps.find((step) => step.action === "panMap");
  assert.ok(panStep);
  assert.match(panStep.selector, /canvas/);
  assert.equal(panStep.direction, "right");
  assert.equal(panStep.distance, 220);
});

test("generated website action plans repair missing map pan steps", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "selectCheckbox", index: 0 },
      { action: "expectVisible", selector: ".mapboxgl-canvas, .leaflet-container, canvas" },
    ],
  }, "check a storm box in a data card and pan the map to verify polygons are on the map", {
    defaultTargetUrl: "http://8.8.8.8/maps",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "selectCheckbox", "panMap", "expectVisible"],
  );
});

test("generated map-polygon checks do not wait for literal polygon text", async () => {
  const plan = await normalizeWebsiteActionPlanWithDefaults({
    targetUrl: "http://8.8.8.8/maps",
    requiresAuth: false,
    steps: [
      { action: "navigate", url: "http://8.8.8.8/maps" },
      { action: "selectCheckbox", index: 0 },
      { action: "waitForText", text: "polygons" },
    ],
  }, "check a storm box in a data card and pan the map to verify polygons are on the map", {
    defaultTargetUrl: "http://8.8.8.8/maps",
    repairGeneratedPlan: true,
  });

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["navigate", "selectCheckbox", "panMap"],
  );
});

test("summarizeFindings fails on same-origin request failures but only flags third-party ones", () => {
  const base = {
    targetUrl: "https://app.example.com/dashboard",
    pageStatus: 200,
    pageInfo: { title: "Dashboard", h1Count: 1, isLikelySpa: false, imagesMissingAlt: 0, controlsMissingName: 0, inputsMissingLabel: 0 },
    consoleErrors: [],
    pageErrors: [],
    blockedRequests: [],
    linkResults: [],
    actionResults: [],
  };

  const sameOrigin = summarizeFindings({
    ...base,
    requestFailures: [{ url: "https://app.example.com/api/events", error: "net::ERR_FAILED" }],
  });
  assert.equal(sameOrigin.failures.some((f) => /same-origin network request/.test(f)), true);

  const thirdParty = summarizeFindings({
    ...base,
    requestFailures: [{ url: "https://cdn.thirdparty.com/widget.js", error: "net::ERR_FAILED" }],
  });
  assert.equal(thirdParty.failures.some((f) => /network request/.test(f)), false);
  assert.equal(thirdParty.manual.some((m) => /third-party network request/.test(m)), true);
});

test("summarizeFindings treats authenticated same-origin link probe failures as advisory", () => {
  const findings = summarizeFindings({
    targetUrl: "https://app.hailtrace.com/maps",
    pageStatus: 200,
    pageInfo: { title: "Maps", h1Count: 1, isLikelySpa: false, imagesMissingAlt: 0, controlsMissingName: 0, inputsMissingLabel: 0 },
    consoleErrors: [],
    pageErrors: [],
    blockedRequests: [],
    requestFailures: [],
    linkResults: [{ url: "https://app.hailtrace.com/dashboard", ok: false, status: 0, error: "Link request timed out." }],
    actionResults: [{ ok: true, action: "authenticate", detail: "Logged in." }],
  });

  assert.equal(findings.failures.some((f) => /same-origin link/.test(f)), false);
  assert.equal(findings.manual.some((m) => /outside the authenticated browser session/.test(m)), true);
});

test("successful browser objectives pass with advisory page concerns", () => {
  const pageInfo = {
    title: "Maps",
    h1Count: 1,
    isLikelySpa: false,
    imagesMissingAlt: 0,
    controlsMissingName: 6,
    inputsMissingLabel: 1,
    links: [],
  };
  const actionResults = [
    { ok: true, action: "navigate", detail: "Navigated to https://app.hailtrace.com/maps with status 200." },
    { ok: true, action: "selectCheckbox", detail: "Selected checkbox #1 and confirmed it is checked." },
  ];
  const findings = summarizeFindings({
    targetUrl: "https://app.hailtrace.com/maps",
    pageStatus: 200,
    pageInfo,
    consoleErrors: ["A non-blocking browser console error"],
    pageErrors: [],
    blockedRequests: [],
    requestFailures: [],
    linkResults: [{ url: "https://app.hailtrace.com/dashboard", ok: false, status: 0, error: "Link request timed out." }],
    actionResults,
  });
  const analysis = buildAnalysis({
    description: "make sure boxes can be checked",
    targetUrl: "https://app.hailtrace.com/maps",
    pageStatus: 200,
    pageInfo,
    findings,
    linkResults: [],
    actionResults,
  });

  assert.equal(findings.failures.length, 0);
  assert.equal(findings.manual.some((finding) => /browser console error/.test(finding)), true);
  assert.equal(findings.manual.some((finding) => /accessible name/.test(finding)), true);
  assert.equal(analysis.verdict, "PASS");
});

test("withPlaywrightSlot caps concurrency and rejects once the queue overflows", async () => {
  const { withPlaywrightSlot, WebsiteQaBusyError } = await import("../server/websiteQa/runGate.mjs");

  let release;
  const blocked = new Promise((resolve) => { release = resolve; });

  // MAX_CONCURRENT_PLAYWRIGHT (2) active + MAX_QUEUED_PLAYWRIGHT (8) queued = 10
  // accepted; the 11th concurrent acquire must be rejected as busy.
  const accepted = Array.from({ length: 10 }, () => withPlaywrightSlot(() => blocked));
  await assert.rejects(
    () => withPlaywrightSlot(() => blocked),
    (error) => error instanceof WebsiteQaBusyError,
  );

  release();
  const results = await Promise.all(accepted);
  assert.equal(results.length, 10);

  // After everything drains, a fresh acquire succeeds again (no slot leak).
  assert.equal(await withPlaywrightSlot(() => "ok"), "ok");
});

test("withPlaywrightSlot removes cancelled queued runs", async () => {
  const { withPlaywrightSlot } = await import("../server/websiteQa/runGate.mjs");

  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const active = [
    withPlaywrightSlot(() => blocked),
    withPlaywrightSlot(() => blocked),
  ];
  const controller = new AbortController();
  const queued = withPlaywrightSlot(() => "should not run", { signal: controller.signal });

  controller.abort();
  await assert.rejects(queued, /cancelled/i);

  release();
  await Promise.all(active);
  assert.equal(await withPlaywrightSlot(() => "ok"), "ok");
});

test("normalizeVerdict is shared and resolves canonical verdicts consistently", () => {
  assert.equal(normalizeVerdict("PASS"), "PASS");
  assert.equal(normalizeVerdict("FAIL"), "FAIL");
  assert.equal(normalizeVerdict("NEEDS MANUAL CHECK"), "NEEDS MANUAL CHECK");
  // When a string is ambiguous, FAIL wins so a run is never reported as PASS
  // while any failure signal is present.
  assert.equal(normalizeVerdict("PASS with FAIL notes"), "FAIL");
  assert.equal(normalizeVerdict(""), "NEEDS MANUAL CHECK");
});

test("OpenAI-guided QA failure classification gives actionable locations", () => {
  assert.equal(
    classifyWebsiteQaExecutionError(new Error("browserType.launch: bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied")).errorLocation,
    "Local Playwright runtime",
  );
  assert.equal(
    classifyWebsiteQaExecutionError(new Error("Target-site authentication is required, but TARGET_SITE_LOGIN_URL is not fully configured.")).errorLocation,
    "Target-site authentication",
  );
  assert.equal(
    classifyWebsiteQaExecutionError(new Error("Target-site login URL must use the same origin as the page under test.")).errorLocation,
    "Target-site authentication",
  );
  assert.equal(
    classifyWebsiteQaExecutionError(new Error("Website resolves to a private, local, or reserved IP address.")).errorLocation,
    "Website URL safety validation",
  );
});
