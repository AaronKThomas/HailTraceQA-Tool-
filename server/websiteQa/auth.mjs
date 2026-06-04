import { hasTargetSiteAuthConfig } from "../config.mjs";
import { NAVIGATION_TIMEOUT_MS, STEP_TIMEOUT_MS } from "./constants.mjs";
import { assertSafeWebsiteUrl, ensureSameOrigin, redactUrlForLog } from "./urlSafety.mjs";

// Login forms vary widely: some use associated <label>s, others only
// placeholders or name attributes. Rather than assume one shape, try the
// configured locator first, then progressively more generic fallbacks. The
// first candidate that resolves to a visible field wins.
async function fillLoginField(page, candidates, value, fieldName) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const locator = candidate.first();
    try {
      await locator.waitFor({ state: "visible", timeout: 2500 });
      await locator.fill(value, { timeout: STEP_TIMEOUT_MS });
      return;
    } catch {
      // Try the next strategy.
    }
  }
  throw new Error(`Could not locate the ${fieldName} field on the login page. Set TARGET_SITE_${fieldName.toUpperCase()}_SELECTOR.`);
}

// Surface a visible login error so a failed authentication produces an
// actionable message instead of a generic "could not confirm". Best-effort:
// returns "" when no common error element is visible.
async function readVisibleLoginError(page) {
  const candidates = [
    "[role='alert']",
    "[aria-invalid='true']",
    "[data-testid='error']",
    ".error",
    ".error-message",
  ];
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible()) {
        const text = (await locator.innerText()).trim();
        if (text) return text.replace(/\s+/g, " ").slice(0, 200);
      }
    } catch {
      // Element not present or not readable; try the next candidate.
    }
  }
  return "";
}

// Authentication must NOT be reported as successful unless there is a POSITIVE
// signal that it worked, or downstream checks run against a login wall and
// produce misleading PASS/FAIL verdicts. Two accepted signals:
//   1. A configured post-login selector becomes visible (authoritative).
//   2. Otherwise, the browser navigates away from the login page.
// A merely-hidden password field is NOT treated as success: error states often
// collapse the form without a real session.
async function assertLoginSucceeded(page, config, loginUrl) {
  if (config.targetSiteLoggedInSelector) {
    const ok = await page.locator(config.targetSiteLoggedInSelector).first()
      .waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    throw new Error(
      "Target-site login could not be confirmed: the configured TARGET_SITE_LOGGED_IN_SELECTOR never became visible after submitting credentials.",
    );
  }

  const loginPath = new URL(loginUrl).pathname;
  // Allow a delayed redirect to settle, then require that we actually left the
  // login page.
  await page.waitForURL((url) => new URL(url).pathname !== loginPath, { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
  if (new URL(page.url()).pathname !== loginPath) return;

  const errorText = await readVisibleLoginError(page);
  throw new Error(
    errorText
      ? `Target-site login failed: ${errorText}`
      : "Target-site login could not be confirmed: the browser never left the login page after submitting credentials (possible wrong credentials, MFA, or CAPTCHA). For single-page apps that keep the same URL, set TARGET_SITE_LOGGED_IN_SELECTOR.",
  );
}

async function clickLoginSubmit(page, config) {
  const candidates = [
    config.targetSiteSubmitSelector ? page.locator(config.targetSiteSubmitSelector) : null,
    config.targetSiteSubmitName ? page.getByRole("button", { name: config.targetSiteSubmitName }) : null,
    page.locator("button[type='submit'], input[type='submit']"),
    page.getByRole("button", { name: /log\s?in|sign\s?in|continue/i }),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const locator = candidate.first();
    try {
      await locator.waitFor({ state: "visible", timeout: 2500 });
      await locator.click({ timeout: STEP_TIMEOUT_MS });
      return;
    } catch {
      // Try the next strategy.
    }
  }
  throw new Error("Could not locate the login submit button. Set TARGET_SITE_SUBMIT_NAME or TARGET_SITE_SUBMIT_SELECTOR.");
}

export async function authenticateTargetSite(context, config, targetUrl, actionResults) {
  if (!hasTargetSiteAuthConfig(config)) {
    throw new Error("Target-site authentication is required, but TARGET_SITE_LOGIN_URL, TARGET_SITE_TEST_EMAIL, and TARGET_SITE_TEST_PASSWORD are not fully configured.");
  }

  const loginUrl = await assertSafeWebsiteUrl(config.targetSiteLoginUrl);
  ensureSameOrigin(
    loginUrl,
    new URL(targetUrl).origin,
    "Target-site login URL must use the same origin as the page under test.",
  );

  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });

    await fillLoginField(page, [
      config.targetSiteEmailSelector ? page.locator(config.targetSiteEmailSelector) : null,
      page.locator("input[type='email'], input[name='email' i], input[name='username' i], input[autocomplete='username']"),
      config.targetSiteEmailLabel ? page.getByPlaceholder(config.targetSiteEmailLabel, { exact: false }) : null,
      config.targetSiteEmailLabel ? page.getByLabel(config.targetSiteEmailLabel, { exact: false }) : null,
    ], config.targetSiteTestEmail, "email");

    await fillLoginField(page, [
      config.targetSitePasswordSelector ? page.locator(config.targetSitePasswordSelector) : null,
      page.locator("input[type='password'], input[name='password' i]"),
      config.targetSitePasswordLabel ? page.getByPlaceholder(config.targetSitePasswordLabel, { exact: false }) : null,
      config.targetSitePasswordLabel ? page.getByLabel(config.targetSitePasswordLabel, { exact: false }) : null,
    ], config.targetSiteTestPassword, "password");

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {}),
      clickLoginSubmit(page, config),
    ]);
    await assertLoginSucceeded(page, config, loginUrl);
    actionResults.push({
      ok: true,
      action: "authenticate",
      detail: `Logged into ${redactUrlForLog(loginUrl)} with configured target-site test account.`,
    });
  } finally {
    await page.close().catch(() => {});
  }
}
