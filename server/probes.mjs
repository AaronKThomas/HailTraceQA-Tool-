// Lightweight liveness probes for each external integration.
//
// Used by /health/integrations to give operators a quick connectivity check
// without leaking secrets. Probes never throw — they always resolve to a
// shape { state, message } so the route can return them uniformly.

import {
  hasOpenAiConfig,
  hasRealHailTraceConfig,
  hasRealJiraConfig,
  hasRealSlackConfig,
  hasRealZohoCliqConfig,
} from "./config.mjs";

export function safeHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOpenAi(config) {
  if (!hasOpenAiConfig(config)) {
    return { state: "demo", message: "Not configured — set OPENAI_API_KEY in .env" };
  }
  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    });
    if (response.ok) {
      return { state: "connected", message: `Ready (${config.openaiModel})` };
    }
    if (response.status === 401) {
      return { state: "error", message: "Invalid API key" };
    }
    if (response.status === 429) {
      return { state: "error", message: "Rate limited or quota exhausted" };
    }
    return { state: "error", message: `OpenAI returned HTTP ${response.status}` };
  } catch (error) {
    if (error.name === "AbortError") {
      return { state: "error", message: "Connection timed out" };
    }
    return { state: "error", message: "Cannot reach OpenAI" };
  }
}

export async function probeHailTrace(config) {
  if (!hasRealHailTraceConfig(config)) {
    return { state: "demo", message: "Not configured — set HAILTRACE_API_KEY in .env" };
  }
  try {
    const url = new URL(config.hailtraceApiBaseUrl);
    await fetchWithTimeout(url.origin, { method: "GET" });
    return {
      state: "connected",
      message: `Reachable at ${url.hostname}${config.hailtraceQaPath || ""}`,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { state: "error", message: "Connection timed out" };
    }
    return { state: "error", message: "Cannot reach HailTrace API" };
  }
}

export async function probeJira(config) {
  if (!hasRealJiraConfig(config)) {
    return { state: "demo", message: "Not configured — set JIRA_BASE_URL/EMAIL/API_TOKEN in .env" };
  }
  try {
    const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString("base64");
    const baseUrl = String(config.jiraBaseUrl).replace(/\/$/, "");
    const response = await fetchWithTimeout(`${baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (response.ok) {
      const me = await response.json().catch(() => ({}));
      const who = me.emailAddress || me.displayName || new URL(baseUrl).hostname;
      return { state: "connected", message: `Signed in as ${who}` };
    }
    if (response.status === 401) {
      return { state: "error", message: "Invalid email or API token" };
    }
    if (response.status === 403) {
      return { state: "error", message: "Account does not have access" };
    }
    return { state: "error", message: `Jira returned HTTP ${response.status}` };
  } catch (error) {
    if (error.name === "AbortError") {
      return { state: "error", message: "Connection timed out" };
    }
    return { state: "error", message: "Cannot reach Jira" };
  }
}

export function probeSlack(config) {
  if (!hasRealSlackConfig(config)) {
    return { state: "demo", message: "Not configured — set SLACK_WEBHOOK_URL in .env" };
  }
  try {
    const url = new URL(config.slackWebhookUrl);
    if (!url.hostname.endsWith("slack.com")) {
      return { state: "warning", message: "Webhook URL does not look like Slack" };
    }
    return { state: "configured", message: "Webhook saved (use Settings to send a test message)" };
  } catch {
    return { state: "error", message: "Invalid webhook URL" };
  }
}

export function probeZohoCliq(config) {
  if (!hasRealZohoCliqConfig(config)) {
    return { state: "demo", message: "Not configured — set ZOHO_CLIQ_WEBHOOK_URL in .env" };
  }
  try {
    const url = new URL(config.zohoCliqWebhookUrl);
    if (!url.hostname.includes("zoho")) {
      return { state: "warning", message: "Webhook URL does not look like Zoho Cliq" };
    }
    return { state: "configured", message: "Webhook saved (use Settings to send a test message)" };
  } catch {
    return { state: "error", message: "Invalid webhook URL" };
  }
}
