import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJiraIssue, runHailTraceTest, sendSlackWebhook, sendZohoCliqWebhook } from "./server/integrations.mjs";
import { runOpenAiGuidedHailTraceTest, runOpenAiQaPlan } from "./server/openai.mjs";
import {
  formatJiraTicketDescription,
  parseJiraKey,
  shouldLoadJiraTicket,
} from "./server/jiraKey.mjs";
import { loadEnv } from "./server/loadEnv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnv(__dirname);

const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

function buildConfig() {
  return {
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
  };
}

const CONFIG = buildConfig();

const app = express();

app.use(cors());
app.use(express.json());

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAccounts() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(ACCOUNTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAccounts(accounts) {
  await ensureDataDir();
  await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function sanitizeAccount(account) {
  return {
    username: account.username,
    displayName: account.displayName,
    registeredAt: account.registeredAt,
  };
}

function hasRealJiraConfig() {
  return Boolean(CONFIG.jiraBaseUrl && CONFIG.jiraEmail && CONFIG.jiraApiToken);
}

function hasRealHailTraceConfig() {
  return Boolean(CONFIG.hailtraceApiBaseUrl && CONFIG.hailtraceApiKey);
}

function hasRealSlackConfig() {
  return Boolean(CONFIG.slackWebhookUrl);
}

function hasRealZohoCliqConfig() {
  return Boolean(CONFIG.zohoCliqWebhookUrl);
}

function hasOpenAiConfig() {
  return Boolean(CONFIG.openaiApiKey);
}

function getRuntimeMode() {
  const probes = [
    hasRealHailTraceConfig(),
    hasRealJiraConfig(),
    hasRealSlackConfig(),
    hasOpenAiConfig(),
    hasRealZohoCliqConfig(),
  ];
  const live = probes.filter(Boolean).length;

  if (live === 0) return "mock";
  if (live >= probes.length) return "live";
  return "hybrid";
}

function validateConfig() {
  const groups = [
    {
      name: "HailTrace API",
      values: [
        ["HAILTRACE_API_BASE_URL", CONFIG.hailtraceApiBaseUrl],
        ["HAILTRACE_API_KEY", CONFIG.hailtraceApiKey],
      ],
    },
    {
      name: "Jira",
      values: [
        ["JIRA_BASE_URL", CONFIG.jiraBaseUrl],
        ["JIRA_EMAIL", CONFIG.jiraEmail],
        ["JIRA_API_TOKEN", CONFIG.jiraApiToken],
      ],
    },
    {
      name: "Slack",
      values: [
        ["SLACK_WEBHOOK_URL", CONFIG.slackWebhookUrl],
      ],
    },
    {
      name: "Zoho Cliq",
      values: [
        ["ZOHO_CLIQ_WEBHOOK_URL", CONFIG.zohoCliqWebhookUrl],
      ],
    },
    {
      name: "OpenAI",
      values: [
        ["OPENAI_API_KEY", CONFIG.openaiApiKey],
      ],
    },
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

async function resolveTestInput(description, jiraKey) {
  let text = String(description).trim();
  let ticketKey = jiraKey ? String(jiraKey).toUpperCase() : parseJiraKey(text);

  if (ticketKey && hasRealJiraConfig() && shouldLoadJiraTicket(text, ticketKey)) {
    try {
      const issue = await fetchJiraIssue(CONFIG, ticketKey);
      ticketKey = (issue.key || ticketKey).toUpperCase();
      text = formatJiraTicketDescription(issue);
    } catch (error) {
      console.warn(`[jira] Could not load ${ticketKey}: ${error.message}`);
    }
  } else if (!ticketKey) {
    ticketKey = parseJiraKey(text);
  }

  return { text, ticketKey: ticketKey || null };
}

function buildMockAnalysis(description, jiraKey) {
  const lower = description.toLowerCase();
  const failSignals = ["error", "broken", "fail", "crash", "missing"];
  const manualSignals = ["manual", "verify", "review", "check visually"];

  if (failSignals.some((signal) => lower.includes(signal))) {
    return {
      verdict: "FAIL",
      analysis: [
        "WHAT IS BEING TESTED",
        description,
        "",
        "API RESULTS",
        "Demo mode: failure-oriented language detected in the request.",
        "",
        "CODE ANALYSIS",
        "No live HailTrace API call was made.",
        "",
        "ERROR LOCATION",
        jiraKey ? `Potentially related to ${jiraKey}.` : "No Jira ticket attached.",
        "",
        "RECOMMENDATIONS",
        "Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env for live QA.",
        "",
        "VERDICT: FAIL",
      ].join("\n"),
      apiResults: [
        {
          type: "REST",
          method: "POST",
          endpoint: "/mock/run-test",
          description: "Demo QA evaluation",
          result: { ok: false, status: 500 },
          error: "Demo mode simulated failure.",
        },
      ],
      playwrightLog: "[demo] Browser flow aborted after simulated failure.",
    };
  }

  if (manualSignals.some((signal) => lower.includes(signal))) {
    return {
      verdict: "NEEDS MANUAL CHECK",
      analysis: [
        "WHAT IS BEING TESTED",
        description,
        "",
        "API RESULTS",
        "Demo mode: request appears to need human verification.",
        "",
        "CODE ANALYSIS",
        "No live HailTrace API call was made.",
        "",
        "RECOMMENDATIONS",
        "Review manually or connect the HailTrace API in .env.",
        "",
        "VERDICT: NEEDS MANUAL CHECK",
      ].join("\n"),
      apiResults: [
        {
          type: "REST",
          method: "POST",
          endpoint: "/mock/run-test",
          description: "Demo QA evaluation",
          result: { ok: true, status: 202 },
        },
      ],
      playwrightLog: "[demo] Browser flow requires human review.",
    };
  }

  return {
    verdict: "PASS",
    analysis: [
      "WHAT IS BEING TESTED",
      description,
      "",
      "API RESULTS",
      "Demo mode: simulated successful QA evaluation.",
      "",
      "CODE ANALYSIS",
      "No live HailTrace API call was made.",
      "",
      "RECOMMENDATIONS",
      "Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env for live QA.",
      "",
      "VERDICT: PASS",
    ].join("\n"),
    apiResults: [
      {
        type: "REST",
        method: "POST",
        endpoint: "/mock/run-test",
        description: "Demo QA evaluation",
        result: { ok: true, status: 200 },
      },
    ],
    playwrightLog: "[demo] Browser flow completed successfully.",
  };
}

function safeHostname(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "hailtrace-qa-local-backend",
    mode: getRuntimeMode(),
    integrations: {
      hailtrace: hasRealHailTraceConfig() ? "live" : "demo",
      jira: hasRealJiraConfig() ? "live" : "demo",
      slack: hasRealSlackConfig() ? "live" : "demo",
      openai: hasOpenAiConfig() ? "live" : "demo",
      zohoCliq: hasRealZohoCliqConfig() ? "live" : "demo",
    },
    details: {
      openaiModel: hasOpenAiConfig() ? CONFIG.openaiModel : null,
      hailtraceHost: safeHostname(CONFIG.hailtraceApiBaseUrl),
      hailtraceQaPath: CONFIG.hailtraceQaPath,
      jiraHost: safeHostname(CONFIG.jiraBaseUrl),
      slackConfigured: hasRealSlackConfig(),
      zohoCliqConfigured: hasRealZohoCliqConfig(),
    },
  });
});

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeOpenAi() {
  if (!hasOpenAiConfig()) {
    return { state: "demo", message: "Not configured — set OPENAI_API_KEY in .env" };
  }
  try {
    const response = await fetchWithTimeout("https://api.openai.com/v1/models?limit=1", {
      headers: { Authorization: `Bearer ${CONFIG.openaiApiKey}` },
    });
    if (response.ok) {
      return { state: "connected", message: `Ready (${CONFIG.openaiModel})` };
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

async function probeHailTrace() {
  if (!hasRealHailTraceConfig()) {
    return { state: "demo", message: "Not configured — set HAILTRACE_API_KEY in .env" };
  }
  try {
    const url = new URL(CONFIG.hailtraceApiBaseUrl);
    await fetchWithTimeout(url.origin, { method: "GET" });
    return {
      state: "connected",
      message: `Reachable at ${url.hostname}${CONFIG.hailtraceQaPath || ""}`,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return { state: "error", message: "Connection timed out" };
    }
    return { state: "error", message: "Cannot reach HailTrace API" };
  }
}

async function probeJira() {
  if (!hasRealJiraConfig()) {
    return { state: "demo", message: "Not configured — set JIRA_BASE_URL/EMAIL/API_TOKEN in .env" };
  }
  try {
    const auth = Buffer.from(`${CONFIG.jiraEmail}:${CONFIG.jiraApiToken}`).toString("base64");
    const baseUrl = String(CONFIG.jiraBaseUrl).replace(/\/$/, "");
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

function probeSlack() {
  if (!hasRealSlackConfig()) {
    return { state: "demo", message: "Not configured — set SLACK_WEBHOOK_URL in .env" };
  }
  try {
    const url = new URL(CONFIG.slackWebhookUrl);
    if (!url.hostname.endsWith("slack.com")) {
      return { state: "warning", message: "Webhook URL does not look like Slack" };
    }
    return { state: "configured", message: "Webhook saved (use Settings to send a test message)" };
  } catch {
    return { state: "error", message: "Invalid webhook URL" };
  }
}

function probeZohoCliq() {
  if (!hasRealZohoCliqConfig()) {
    return { state: "demo", message: "Not configured — set ZOHO_CLIQ_WEBHOOK_URL in .env" };
  }
  try {
    const url = new URL(CONFIG.zohoCliqWebhookUrl);
    if (!url.hostname.includes("zoho")) {
      return { state: "warning", message: "Webhook URL does not look like Zoho Cliq" };
    }
    return { state: "configured", message: "Webhook saved (use Settings to send a test message)" };
  } catch {
    return { state: "error", message: "Invalid webhook URL" };
  }
}

app.get("/health/integrations", async (_req, res) => {
  const [openai, hailtrace, jira] = await Promise.all([
    probeOpenAi(),
    probeHailTrace(),
    probeJira(),
  ]);
  res.json({
    integrations: {
      openai,
      hailtrace,
      jira,
      slack: probeSlack(),
      zohoCliq: probeZohoCliq(),
    },
    checkedAt: new Date().toISOString(),
  });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const accounts = await readAccounts();
  const match = accounts.find(
    (account) =>
      account.username.toLowerCase() === String(username).toLowerCase()
      && account.password === password,
  );

  if (!match) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  return res.json({ account: sanitizeAccount(match) });
});

app.post("/register", async (req, res) => {
  const { username, displayName, password } = req.body || {};
  if (!username || !displayName || !password) {
    return res.status(400).json({ error: "Username, display name, and password are required." });
  }

  const accounts = await readAccounts();
  if (accounts.some((account) => account.username.toLowerCase() === String(username).toLowerCase())) {
    return res.status(409).json({ error: "Username already taken." });
  }

  const account = {
    username: String(username).trim(),
    displayName: String(displayName).trim(),
    password: String(password),
    registeredAt: new Date().toISOString(),
  };

  accounts.push(account);
  await writeAccounts(accounts);
  return res.status(201).json({ account: sanitizeAccount(account) });
});

app.get("/accounts", async (_req, res) => {
  const accounts = await readAccounts();
  res.json(accounts.map(sanitizeAccount));
});

app.delete("/accounts/:username", async (req, res) => {
  const username = String(req.params.username || "").toLowerCase();
  const accounts = await readAccounts();
  const nextAccounts = accounts.filter((account) => account.username.toLowerCase() !== username);

  if (nextAccounts.length === accounts.length) {
    return res.status(404).json({ error: "Account not found." });
  }

  await writeAccounts(nextAccounts);
  return res.status(204).send();
});

app.post("/run-test", async (req, res) => {
  const { description, jiraKey } = req.body || {};
  if (!description) {
    return res.status(400).json({ error: "Description is required." });
  }

  const { text, ticketKey } = await resolveTestInput(description, jiraKey);

  if (hasOpenAiConfig()) {
    try {
      const result = hasRealHailTraceConfig()
        ? await runOpenAiGuidedHailTraceTest(CONFIG, text, ticketKey)
        : await runOpenAiQaPlan(CONFIG, text, ticketKey);
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        error: error.message,
        verdict: "FAIL",
        analysis: [
          "WHAT IS BEING TESTED",
          text,
          "",
          "API RESULTS",
          `ChatGPT or HailTrace pipeline failed: ${error.message}`,
          "",
          "RECOMMENDATIONS",
          "Fix OPENAI_API_KEY and HailTrace API credentials, then re-run the test.",
          "",
          "VERDICT: FAIL",
        ].join("\n"),
        recommendations: [],
        apiResults: error.apiResults || [],
        playwrightLog: error.message,
      });
    }
  }

  if (hasRealHailTraceConfig()) {
    try {
      const result = await runHailTraceTest(CONFIG, text, ticketKey);
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        error: error.message,
        verdict: "FAIL",
        analysis: [
          "WHAT IS BEING TESTED",
          text,
          "",
          "API RESULTS",
          `HailTrace API request failed: ${error.message}`,
          "",
          "VERDICT: FAIL",
        ].join("\n"),
        apiResults: error.apiResults || [],
        playwrightLog: "",
      });
    }
  }

  return res.json(buildMockAnalysis(text, ticketKey));
});

app.get("/jira/issue/:key", async (req, res) => {
  const key = String(req.params.key || "").toUpperCase();
  if (!key) {
    return res.status(400).json({ error: "Issue key is required." });
  }

  if (hasRealJiraConfig()) {
    try {
      const issue = await fetchJiraIssue(CONFIG, key);
      return res.json(issue);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  return res.json({
    key,
    summary: `Demo Jira ticket ${key}`,
    description: "Demo mode ticket. Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to .env for live Jira.",
    acceptanceCriteria: "Configure Jira credentials in .env to load real ticket details.",
  });
});

app.post("/notifications/slack", async (req, res) => {
  const { description, status, verdict } = req.body || {};

  if (hasRealSlackConfig()) {
    try {
      const result = await sendSlackWebhook(CONFIG, { description, status, verdict });
      return res.json(result);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    description: description || "",
    status: status || "",
    verdict: verdict || "",
  });
});

app.post("/notifications/slack/test", async (req, res) => {
  if (hasRealSlackConfig()) {
    try {
      const result = await sendSlackWebhook(CONFIG, {
        message: "HailTrace QA test notification — your Slack webhook is connected.",
      });
      return res.json({ ...result, message: "Test notification sent to Slack." });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    message: "Demo mode: Slack test accepted. Add SLACK_WEBHOOK_URL to .env to send for real.",
  });
});

app.post("/notifications/zoho-cliq", async (req, res) => {
  const { description, status, verdict } = req.body || {};

  if (hasRealZohoCliqConfig()) {
    try {
      const result = await sendZohoCliqWebhook(CONFIG, { description, status, verdict });
      return res.json(result);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    description: description || "",
    status: status || "",
    verdict: verdict || "",
  });
});

app.post("/notifications/zoho-cliq/test", async (req, res) => {
  if (hasRealZohoCliqConfig()) {
    try {
      const result = await sendZohoCliqWebhook(CONFIG, {
        message: "HailTrace QA test notification — your Zoho Cliq webhook is connected.",
      });
      return res.json({ ...result, message: "Test notification sent to Zoho Cliq." });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    message: "Demo mode: Zoho Cliq test accepted. Add ZOHO_CLIQ_WEBHOOK_URL to .env to send for real.",
  });
});

app.listen(PORT, () => {
  validateConfig();
  console.log(`HailTrace QA backend listening on http://localhost:${PORT}`);
  console.log(`Mode: ${getRuntimeMode()}`);
  console.log(`  HailTrace QA: ${hasRealHailTraceConfig() ? "live" : "demo"}`);
  console.log(`  Jira:         ${hasRealJiraConfig() ? "live" : "demo"}`);
  console.log(`  Slack:        ${hasRealSlackConfig() ? "live" : "demo"}`);
  console.log(`  Zoho Cliq:    ${hasRealZohoCliqConfig() ? "live" : "demo"}`);
  console.log(`  OpenAI:       ${hasOpenAiConfig() ? "live" : "demo"}`);
});
