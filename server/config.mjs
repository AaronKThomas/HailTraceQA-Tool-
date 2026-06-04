// Runtime configuration + small predicate helpers.
//
// buildConfig() is the ONLY place that reads from process.env. Everything
// else in the server depends on the returned config object so behavior is
// deterministic and testable.

import path from "node:path";

// Default LLM provider. Any OpenAI-compatible endpoint can be substituted via
// OPENAI_BASE_URL (e.g. a local Ollama server at http://localhost:11434/v1),
// which lets the plain-English pipeline run without a paid OpenAI key.
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildConfig({ rootDir }) {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    rootDir,
    isProduction,
    port: Number(process.env.PORT || 3001),
    // HAILTRACE_DATA_DIR is intended ONLY for tests so the harness can point
    // at a temp directory and not touch real account data. Production should
    // never set it.
    dataDir: process.env.HAILTRACE_DATA_DIR
      ? path.resolve(process.env.HAILTRACE_DATA_DIR)
      : path.join(rootDir, "data"),
    testArtifactsDir: process.env.HAILTRACE_TEST_ARTIFACTS_DIR
      ? path.resolve(process.env.HAILTRACE_TEST_ARTIFACTS_DIR)
      : path.join(
        process.env.HAILTRACE_DATA_DIR
          ? path.resolve(process.env.HAILTRACE_DATA_DIR)
          : path.join(rootDir, "data"),
        "test-artifacts",
      ),
    testReplayRecordingEnabled: String(process.env.TEST_REPLAY_RECORDING || "true").toLowerCase() !== "false",
    testReplayRetentionMs: positiveNumber(process.env.TEST_REPLAY_RETENTION_DAYS || 7, 7) * 24 * 60 * 60 * 1000,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    zohoCliqWebhookUrl: process.env.ZOHO_CLIQ_WEBHOOK_URL || "",
    jiraBaseUrl: process.env.JIRA_BASE_URL || "",
    jiraEmail: process.env.JIRA_EMAIL || "",
    jiraApiToken: process.env.JIRA_API_TOKEN || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
    // Default HailTrace page to test when a prompt does not include a URL.
    // Keep this server-side so the LLM/browser runner has one configured source
    // of truth and does not need to invent target URLs from free-form text.
    targetSiteDefaultUrl: process.env.TARGET_SITE_DEFAULT_URL || "https://app.hailtrace.com/maps",
    targetSiteLoginUrl: process.env.TARGET_SITE_LOGIN_URL || "",
    targetSiteTestEmail: process.env.TARGET_SITE_TEST_EMAIL || "",
    targetSiteTestPassword: process.env.TARGET_SITE_TEST_PASSWORD || "",
    targetSiteEmailLabel: process.env.TARGET_SITE_EMAIL_LABEL || "email",
    targetSitePasswordLabel: process.env.TARGET_SITE_PASSWORD_LABEL || "password",
    targetSiteSubmitName: process.env.TARGET_SITE_SUBMIT_NAME || "Log In",
    // Optional CSS selector overrides for non-standard login forms. Empty by
    // default; the runner falls back to type/name/placeholder heuristics.
    targetSiteEmailSelector: process.env.TARGET_SITE_EMAIL_SELECTOR || "",
    targetSitePasswordSelector: process.env.TARGET_SITE_PASSWORD_SELECTOR || "",
    targetSiteSubmitSelector: process.env.TARGET_SITE_SUBMIT_SELECTOR || "",
    // Optional selector that only appears once login has succeeded (e.g. a
    // user menu or dashboard element). When set it is the authoritative signal
    // that authentication worked; otherwise the runner falls back to detecting
    // that the login page was left behind.
    targetSiteLoggedInSelector: process.env.TARGET_SITE_LOGGED_IN_SELECTOR || "",
    sessionSecret: process.env.SESSION_SECRET || (isProduction ? "" : "local-dev-session-secret-change-me"),
    corsAllowedOrigins: String(
      process.env.CORS_ALLOWED_ORIGINS
      || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowDemoMode: String(process.env.ALLOW_DEMO_MODE || (!isProduction)).toLowerCase() === "true",
    // A client-supplied action plan bypasses the LLM and runs Playwright (and
    // optional target-site login) directly from request input. Useful for local
    // testing, but in production it widens abuse of shared target-site
    // credentials, so it is denied by default and must be explicitly enabled.
    allowClientActionPlans: String(process.env.ALLOW_CLIENT_ACTION_PLANS || (!isProduction)).toLowerCase() === "true",
    // Only honor X-Forwarded-For when the app sits behind a trusted reverse
    // proxy/load balancer that sets it. Left false, the header is ignored so a
    // client cannot spoof it to evade per-IP rate limits.
    trustProxy: String(process.env.TRUST_PROXY || "").toLowerCase() === "true",
    customerioAppApiKey: process.env.CUSTOMERIO_APP_API_KEY || "",
    customerioRegion: (process.env.CUSTOMERIO_REGION || "us").toLowerCase(),
    customerioFromName: process.env.CUSTOMERIO_FROM_NAME || "",
    customerioInviteTemplateId: process.env.CUSTOMERIO_INVITE_TEMPLATE_ID || "",
    customerioResetTemplateId: process.env.CUSTOMERIO_RESET_TEMPLATE_ID || "",
    appPublicUrl: (process.env.APP_PUBLIC_URL || "http://localhost:5173").replace(/\/$/, ""),
  };
}

export function hasRealJiraConfig(config) {
  return Boolean(config.jiraBaseUrl && config.jiraEmail && config.jiraApiToken);
}

export function hasRealSlackConfig(config) {
  return Boolean(config.slackWebhookUrl);
}

export function hasRealZohoCliqConfig(config) {
  return Boolean(config.zohoCliqWebhookUrl);
}

export function usesLocalLlmEndpoint(config) {
  return config.openaiBaseUrl !== DEFAULT_OPENAI_BASE_URL;
}

export function hasOpenAiConfig(config) {
  // The hosted OpenAI endpoint requires a key. A self-hosted, OpenAI-compatible
  // endpoint (e.g. local Ollama) does not, so a custom base URL alone is enough
  // to enable the LLM-guided pipeline.
  return Boolean(config.openaiApiKey) || usesLocalLlmEndpoint(config);
}

export function hasTargetSiteAuthConfig(config) {
  return Boolean(config.targetSiteLoginUrl && config.targetSiteTestEmail && config.targetSiteTestPassword);
}

export function hasSessionSecret(config) {
  return Boolean(config.sessionSecret);
}

export function getRuntimeMode(config) {
  const probes = [
    hasRealJiraConfig(config),
    hasRealSlackConfig(config),
    hasOpenAiConfig(config),
    hasRealZohoCliqConfig(config),
  ];
  const live = probes.filter(Boolean).length;
  if (live === 0) return "mock";
  if (live >= probes.length) return "live";
  return "hybrid";
}

export function ensureSessionSecret(config) {
  if (hasSessionSecret(config)) return;
  throw new Error("SESSION_SECRET is required. Generate a long random value for signed session cookies.");
}

export function warnOnPartialConfig(config) {
  const groups = [
    { name: "Jira", values: [
      ["JIRA_BASE_URL", config.jiraBaseUrl],
      ["JIRA_EMAIL", config.jiraEmail],
      ["JIRA_API_TOKEN", config.jiraApiToken],
    ] },
    { name: "Slack", values: [["SLACK_WEBHOOK_URL", config.slackWebhookUrl]] },
    { name: "Zoho Cliq", values: [["ZOHO_CLIQ_WEBHOOK_URL", config.zohoCliqWebhookUrl]] },
    { name: "OpenAI", values: [["OPENAI_API_KEY", config.openaiApiKey]] },
    { name: "Target site auth", values: [
      ["TARGET_SITE_LOGIN_URL", config.targetSiteLoginUrl],
      ["TARGET_SITE_TEST_EMAIL", config.targetSiteTestEmail],
      ["TARGET_SITE_TEST_PASSWORD", config.targetSiteTestPassword],
    ] },
  ];

  for (const group of groups) {
    const present = group.values.filter(([, value]) => Boolean(value));
    if (present.length > 0 && present.length < group.values.length) {
      const missing = group.values
        .filter(([, value]) => !value)
        .map(([key]) => key);
      console.warn(`[config] Partial ${group.name} configuration. Missing: ${missing.join(", ")}`);
    }
  }
}
