// Runtime configuration + small predicate helpers.
//
// buildConfig() is the ONLY place that reads from process.env. Everything
// else in the server depends on the returned config object so behavior is
// deterministic and testable.

import path from "node:path";

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
    hailtraceApiBaseUrl: process.env.HAILTRACE_API_BASE_URL || "",
    hailtraceApiKey: process.env.HAILTRACE_API_KEY || "",
    hailtraceQaPath: process.env.HAILTRACE_QA_PATH || "/qa/run-test",
    hailtraceAuthStyle: (process.env.HAILTRACE_AUTH_STYLE || "bearer").toLowerCase(),
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    zohoCliqWebhookUrl: process.env.ZOHO_CLIQ_WEBHOOK_URL || "",
    jiraBaseUrl: process.env.JIRA_BASE_URL || "",
    jiraEmail: process.env.JIRA_EMAIL || "",
    jiraApiToken: process.env.JIRA_API_TOKEN || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    sessionSecret: process.env.SESSION_SECRET || (isProduction ? "" : "local-dev-session-secret-change-me"),
    corsAllowedOrigins: String(
      process.env.CORS_ALLOWED_ORIGINS
      || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowDemoMode: String(process.env.ALLOW_DEMO_MODE || (!isProduction)).toLowerCase() === "true",
    customerioAppApiKey: process.env.CUSTOMERIO_APP_API_KEY || "",
    customerioRegion: (process.env.CUSTOMERIO_REGION || "us").toLowerCase(),
    customerioFromName: process.env.CUSTOMERIO_FROM_NAME || "",
    customerioInviteTemplateId: process.env.CUSTOMERIO_INVITE_TEMPLATE_ID || "",
    customerioResetTemplateId: process.env.CUSTOMERIO_RESET_TEMPLATE_ID || "",
    appPublicUrl: (process.env.APP_PUBLIC_URL || "http://localhost:5173").replace(/\/$/, ""),
  };
}

export function hasRealHailTraceConfig(config) {
  return Boolean(config.hailtraceApiBaseUrl && config.hailtraceApiKey);
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

export function hasOpenAiConfig(config) {
  return Boolean(config.openaiApiKey);
}

export function hasSessionSecret(config) {
  return Boolean(config.sessionSecret);
}

export function getRuntimeMode(config) {
  const probes = [
    hasRealHailTraceConfig(config),
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
    { name: "HailTrace API", values: [
      ["HAILTRACE_API_BASE_URL", config.hailtraceApiBaseUrl],
      ["HAILTRACE_API_KEY", config.hailtraceApiKey],
    ] },
    { name: "Jira", values: [
      ["JIRA_BASE_URL", config.jiraBaseUrl],
      ["JIRA_EMAIL", config.jiraEmail],
      ["JIRA_API_TOKEN", config.jiraApiToken],
    ] },
    { name: "Slack", values: [["SLACK_WEBHOOK_URL", config.slackWebhookUrl]] },
    { name: "Zoho Cliq", values: [["ZOHO_CLIQ_WEBHOOK_URL", config.zohoCliqWebhookUrl]] },
    { name: "OpenAI", values: [["OPENAI_API_KEY", config.openaiApiKey]] },
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
