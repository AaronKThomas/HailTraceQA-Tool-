import fs from "node:fs";

import { NAVIGATION_TIMEOUT_MS } from "./constants.mjs";
import { executeActionPlan } from "./actionRunner.mjs";
import { normalizeWebsiteActionPlanWithDefaults } from "./actionPlan.mjs";
import { authenticateTargetSite } from "./auth.mjs";
import { checkSameOriginLinks } from "./linkChecker.mjs";
import { collectPageInfo, createEmptyPageInfo } from "./pageAudit.mjs";
import { createVideoReplayArtifact } from "../testArtifacts.mjs";
import {
  buildAnalysis,
  buildMissingUrlResult,
  normalizeVerdict,
  summarizeFindings,
} from "./reporting.mjs";
import { withPlaywrightSlot } from "./runGate.mjs";
import {
  assertSafeWebsiteTarget,
  assertSafeWebsiteUrl,
  extractFirstHttpUrl,
  isTelemetryRequest,
  redactUrlForLog,
} from "./urlSafety.mjs";
import { throwIfAborted } from "../cancellation.mjs";

const MAX_CAPTURED_BROWSER_EVENTS = 50;

// Some dev environments (notably Cursor's sandbox) inject an ephemeral
// PLAYWRIGHT_BROWSERS_PATH that points at a temp cache which does NOT contain
// the installed browsers, so chromium.launch() fails with "Executable doesn't
// exist". If the override is the known sandbox cache or simply doesn't exist on
// disk, drop it so Playwright falls back to its real default cache (where
// `npx playwright install` puts browsers). No-op in production, where the
// variable is unset, and it never strips a legitimate, existing custom path.
function ensureUsablePlaywrightBrowsersPath() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath) return;
  if (browsersPath.includes("cursor-sandbox-cache") || !fs.existsSync(browsersPath)) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

ensureUsablePlaywrightBrowsersPath();

function pushBounded(items, item, maxItems = MAX_CAPTURED_BROWSER_EVENTS) {
  if (items.length < maxItems) items.push(item);
}

// Pin the target hostname to the IP we already validated as public so Chromium
// cannot re-resolve it to a private/internal address between our DNS check and
// its connection (DNS-rebinding defense). No mapping is needed when the target
// is already a literal IP. Sub-resources on other hosts are still validated by
// the per-request route guard below.
function buildHostResolverArgs({ hostname, ip }) {
  if (!ip || hostname === ip || hostname === `[${ip}]`) return [];
  const mapped = ip.includes(":") ? `[${ip}]` : ip;
  return [`--host-resolver-rules=MAP ${hostname} ${mapped}`];
}

export async function runWebsiteQaTest(config, description, jiraKey, actionPlanInput = null, {
  ownerEmail = "",
  repairGeneratedPlan = false,
  signal,
} = {}) {
  throwIfAborted(signal);
  const actionPlan = await normalizeWebsiteActionPlanWithDefaults(actionPlanInput, description, {
    defaultTargetUrl: config.targetSiteDefaultUrl,
    repairGeneratedPlan,
  });
  throwIfAborted(signal);
  const targetUrl = actionPlan?.targetUrl || extractFirstHttpUrl(description) || config.targetSiteDefaultUrl;
  if (!targetUrl) return buildMissingUrlResult(description, jiraKey);

  const safeUrl = actionPlan?.targetUrl || await assertSafeWebsiteUrl(targetUrl);
  // Hold a concurrency slot only for the live browser session. The cheap
  // pre-checks above and the outbound link checks below run outside the slot,
  // so a slow target's link probes never tie up scarce Playwright capacity.
  const session = await withPlaywrightSlot(() => runBrowserSession({ config, actionPlan, safeUrl, ownerEmail, signal }), { signal });
  throwIfAborted(signal);
  return finalizeWebsiteQaResult({ description, jiraKey, safeUrl, signal, ...session });
}

async function runBrowserSession({ config, actionPlan, safeUrl, ownerEmail, signal }) {
  throwIfAborted(signal);
  // Re-validate the final target and capture its public IP so we can pin
  // Chromium's DNS resolution and prevent rebinding to an internal address.
  const pinnedTarget = await assertSafeWebsiteTarget(safeUrl);
  const { chromium } = await import("playwright");
  throwIfAborted(signal);
  const browser = await chromium.launch({
    headless: true,
    args: buildHostResolverArgs(pinnedTarget),
  });
  const closeBrowserOnAbort = () => {
    browser.close().catch(() => {});
  };
  signal?.addEventListener("abort", closeBrowserOnAbort, { once: true });
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const blockedRequests = [];
  const actionResults = [];
  const shouldRecordReplay = config.testReplayRecordingEnabled !== false && Boolean(ownerEmail);
  let context;
  let page;
  let pageStatus = 0;
  let pageInfo = createEmptyPageInfo();
  let replay = null;
  let replayWarning = "";

  try {
    throwIfAborted(signal);
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
      ...(shouldRecordReplay
        ? { recordVideo: { dir: config.testArtifactsDir, size: { width: 1366, height: 768 } } }
        : {}),
    });
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      try {
        await assertSafeWebsiteUrl(requestUrl);
        await route.continue();
      } catch (error) {
        pushBounded(blockedRequests, { url: redactUrlForLog(requestUrl), reason: error.message });
        await route.abort("blockedbyclient");
      }
    });

    if (actionPlan?.requiresAuth) {
      await authenticateTargetSite(context, config, safeUrl, actionResults);
    }

    page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page.on("console", (message) => {
      if (message.type() === "error") pushBounded(consoleErrors, message.text());
    });
    page.on("pageerror", (error) => pushBounded(pageErrors, error.message));
    page.on("requestfailed", (request) => {
      const rawUrl = request.url();
      if (isTelemetryRequest(rawUrl)) return;
      pushBounded(requestFailures, {
        url: redactUrlForLog(rawUrl),
        error: request.failure()?.errorText || "Request failed",
      });
    });

    if (actionPlan) {
      const executed = await executeActionPlan(page, actionPlan, { signal });
      pageStatus = executed.pageStatus;
      actionResults.push(...executed.actionResults);
    } else {
      throwIfAborted(signal);
      const response = await page.goto(safeUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      pageStatus = response?.status() || 0;
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }

    throwIfAborted(signal);
    pageInfo = await collectPageInfo(page);
  } finally {
    signal?.removeEventListener("abort", closeBrowserOnAbort);
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  if (shouldRecordReplay) {
    try {
      const recordedVideoPath = await page?.video()?.path();
      replay = await createVideoReplayArtifact({
        artifactsDir: config.testArtifactsDir,
        ownerEmail,
        sourcePath: recordedVideoPath,
        retentionMs: config.testReplayRetentionMs,
      });
    } catch (error) {
      replayWarning = `Video replay was not saved: ${error.message}`;
    }
  }

  return {
    pageStatus,
    pageInfo,
    consoleErrors,
    pageErrors,
    requestFailures,
    blockedRequests,
    actionResults,
    replay,
    replayWarning,
  };
}

// Runs after the browser slot is released: probes same-origin links, scores the
// findings, and assembles the response envelope.
async function finalizeWebsiteQaResult({
  description,
  jiraKey,
  safeUrl,
  pageStatus,
  pageInfo,
  consoleErrors,
  pageErrors,
  requestFailures,
  blockedRequests,
  actionResults,
  replay,
  replayWarning,
  signal,
}) {
  throwIfAborted(signal);
  const linkResults = await checkSameOriginLinks(safeUrl, pageInfo.links, { signal });
  throwIfAborted(signal);
  const findings = summarizeFindings({
    targetUrl: safeUrl,
    pageStatus,
    pageInfo,
    consoleErrors,
    pageErrors,
    requestFailures,
    blockedRequests,
    linkResults,
    actionResults,
  });
  const analysis = buildAnalysis({
    description,
    jiraKey,
    targetUrl: safeUrl,
    pageStatus,
    pageInfo,
    findings,
    linkResults,
    actionResults,
  });
  const verdict = normalizeVerdict(analysis.verdict);

  return {
    verdict,
    analysis: analysis.analysis,
    recommendations: findings.failures.concat(findings.manual).map((finding) => ({
      title: verdict === "FAIL" ? "Fix failed browser check" : "Review browser QA finding",
      description: finding,
    })),
    apiResults: [{
      type: "BROWSER",
      method: "GET",
      endpoint: redactUrlForLog(safeUrl),
      description: "Local Playwright website QA",
      result: {
        ok: verdict !== "FAIL",
        status: pageStatus,
        actionSteps: actionResults.length,
        checkedLinks: linkResults.length,
        replay: Boolean(replay),
      },
      error: verdict === "FAIL" ? findings.failures.join(" ") : undefined,
    }],
    playwrightLog: [
      `[playwright] Loaded ${redactUrlForLog(safeUrl)} with status ${pageStatus || "unknown"}`,
      actionResults.length
        ? `[playwright] Action steps: ${actionResults.filter((result) => result.ok).length}/${actionResults.length} passed`
        : "[playwright] Action steps: none",
      `[playwright] Console errors: ${consoleErrors.length}`,
      `[playwright] Page errors: ${pageErrors.length}`,
      `[playwright] Request failures: ${requestFailures.length}`,
      `[playwright] Blocked private/unsupported requests: ${blockedRequests.length}`,
      `[playwright] Same-origin links checked: ${linkResults.length}`,
      replay ? "[playwright] Video replay saved." : "[playwright] Video replay unavailable.",
      ...(replayWarning ? [`[playwright] ${replayWarning}`] : []),
    ].join("\n"),
    replay,
  };
}
