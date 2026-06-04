import { redactUrlForLog } from "./urlSafety.mjs";

export function normalizeVerdict(value) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("FAIL")) return "FAIL";
  if (raw.includes("PASS")) return "PASS";
  return "NEEDS MANUAL CHECK";
}

// Parse an origin, returning "" for anything that is not a valid absolute URL.
// Centralizes the try/catch so callers can compare origins without repeating it.
function toOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

// A request failure on the page's own origin signals a broken first-party
// resource or API and should fail the run. Third-party failures (widgets,
// CDNs) are noisier and less actionable, so they stay as manual review.
function isSameOriginFailure(failure, origin) {
  return Boolean(origin) && toOrigin(failure.url) === origin;
}

function isAuthenticatedRun(actionResults) {
  return actionResults.some((result) => result.action === "authenticate" && result.ok);
}

function hasCompletedBrowserObjective(actionResults) {
  const objectiveSteps = actionResults.filter((result) => result.action !== "authenticate");
  return objectiveSteps.length > 0 && objectiveSteps.every((result) => result.ok);
}

function formatLinkStatus(link) {
  if (link.status) return link.status;
  const reason = String(link.error || "").trim().replace(/\s+/g, " ").slice(0, 120);
  return reason ? `blocked (${reason})` : "blocked";
}

export function summarizeFindings({ targetUrl, pageStatus, pageInfo, consoleErrors, pageErrors, requestFailures, blockedRequests, linkResults, actionResults = [] }) {
  const failures = [];
  const manual = [];
  const pageOrigin = toOrigin(targetUrl);
  const authenticatedRun = isAuthenticatedRun(actionResults);
  const completedBrowserObjective = hasCompletedBrowserObjective(actionResults);
  const addRuntimeFinding = (finding) => {
    (completedBrowserObjective ? manual : failures).push(finding);
  };

  if (!pageStatus || pageStatus >= 400) {
    failures.push(`Page returned HTTP ${pageStatus || "unknown"}.`);
  }
  if (consoleErrors.length) {
    addRuntimeFinding(`${consoleErrors.length} browser console error(s) were recorded.`);
  }
  if (pageErrors.length) {
    addRuntimeFinding(`${pageErrors.length} uncaught page error(s) were recorded.`);
  }
  const failedAction = actionResults.find((result) => !result.ok);
  if (failedAction) {
    failures.push(failedAction.detail);
  }
  const brokenLinks = linkResults.filter((link) => !link.ok);
  if (brokenLinks.length) {
    if (authenticatedRun || completedBrowserObjective) {
      manual.push(`${brokenLinks.length} same-origin link probe(s) could not be verified outside the authenticated browser session.`);
    } else {
      failures.push(`${brokenLinks.length} same-origin link check(s) failed.`);
    }
  }
  const sameOriginRequestFailures = requestFailures.filter((failure) => isSameOriginFailure(failure, pageOrigin));
  if (sameOriginRequestFailures.length) {
    addRuntimeFinding(`${sameOriginRequestFailures.length} same-origin network request(s) failed during page load.`);
  }

  if (!pageInfo.title) manual.push("Document title is missing.");
  // Multiple h1s are a real accessibility defect. A missing h1 only matters on
  // content pages; SPAs frequently render headings dynamically below a framework
  // root, so a zero count there is expected rather than a defect.
  if (pageInfo.h1Count > 1) {
    manual.push(`Expected at most one h1; found ${pageInfo.h1Count}.`);
  } else if (pageInfo.h1Count === 0 && !pageInfo.isLikelySpa) {
    manual.push("No h1 heading was found.");
  }
  if (pageInfo.imagesMissingAlt > 0) manual.push(`${pageInfo.imagesMissingAlt} image(s) are missing alt text.`);
  if (pageInfo.controlsMissingName > 0) manual.push(`${pageInfo.controlsMissingName} button/input control(s) are missing an accessible name.`);
  if (pageInfo.inputsMissingLabel > 0) manual.push(`${pageInfo.inputsMissingLabel} form field(s) are missing labels.`);
  const thirdPartyRequestFailures = requestFailures.length - sameOriginRequestFailures.length;
  if (thirdPartyRequestFailures > 0) manual.push(`${thirdPartyRequestFailures} third-party network request(s) failed during page load.`);
  if (blockedRequests.length) manual.push(`${blockedRequests.length} private or unsupported request(s) were blocked.`);

  return { failures, manual };
}

// Failures are blocking. Manual findings are advisory for explicit browser
// objectives that completed, so a successful checkbox/click/search task can pass
// while still explaining unrelated page concerns.
function deriveVerdict(findings, actionResults) {
  if (findings.failures.length) return "FAIL";
  if (hasCompletedBrowserObjective(actionResults)) return "PASS";
  if (findings.manual.length) return "NEEDS MANUAL CHECK";
  return "PASS";
}

export function buildAnalysis({ description, jiraKey, targetUrl, pageStatus, pageInfo, findings, linkResults, actionResults = [] }) {
  const verdict = deriveVerdict(findings, actionResults);
  const allFindings = findings.failures.concat(findings.manual);
  const checkedLinks = linkResults.length
    ? linkResults.map((link) => `- ${formatLinkStatus(link)} ${redactUrlForLog(link.url)}`).join("\n")
    : "No same-origin links were checked.";
  const actionSummary = actionResults.length
    ? actionResults.map((result) => `- ${result.ok ? "PASS" : "FAIL"} ${result.action}: ${result.detail}`).join("\n")
    : "No page actions were requested.";

  return {
    verdict,
    analysis: [
      "WHAT IS BEING TESTED",
      jiraKey ? `[${jiraKey}] ${description}` : description,
      "",
      "API RESULTS",
      `Local Playwright browser check ran against ${redactUrlForLog(targetUrl)}. Main page status: ${pageStatus || "unknown"}.`,
      "",
      "CODE ANALYSIS",
      [
        `Title: ${pageInfo.title || "(missing)"}`,
        `H1 count: ${pageInfo.h1Count}`,
        `Images missing alt text: ${pageInfo.imagesMissingAlt}`,
        `Controls missing accessible names: ${pageInfo.controlsMissingName}`,
        `Inputs missing labels: ${pageInfo.inputsMissingLabel}`,
        "",
        "Page action steps:",
        actionSummary,
        "",
        "Same-origin link checks:",
        checkedLinks,
      ].join("\n"),
      "",
      "ERROR LOCATION",
      allFindings.join("\n") || "No defects located by the automated browser smoke check.",
      "",
      "RECOMMENDATIONS",
      allFindings.join("\n") || "Keep this URL in the regression suite and re-run after UI or routing changes.",
      "",
      `VERDICT: ${verdict}`,
    ].join("\n"),
  };
}

export function buildMissingUrlResult(description, jiraKey) {
  const verdict = "NEEDS MANUAL CHECK";
  return {
    verdict,
    analysis: [
      "WHAT IS BEING TESTED",
      jiraKey ? `[${jiraKey}] ${description}` : description,
      "",
      "API RESULTS",
      "No website URL was found, so local Playwright execution did not run.",
      "",
      "CODE ANALYSIS",
      "Add an http:// or https:// URL to the test request for automated website QA.",
      "",
      "ERROR LOCATION",
      "Execution pending - missing target website URL.",
      "",
      "RECOMMENDATIONS",
      "Paste the page URL with the QA request, then re-run the test.",
      "",
      `VERDICT: ${verdict}`,
    ].join("\n"),
    recommendations: [{
      title: "Add a website URL",
      description: "Local Playwright execution needs a public http:// or https:// URL to test.",
    }],
    apiResults: [],
    playwrightLog: "[playwright] Skipped: no website URL found.",
  };
}
