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
import {
  applySecurityHeaders,
  buildCorsOptions,
  clearSessionCookie,
  createRateLimiter,
  getClientIp,
  getSessionCookieName,
  hashPassword,
  parseCookies,
  readSessionCookie,
  requireNonEmptyString,
  setSessionCookie,
  validateDisplayName,
  validateEmail,
  validatePassword,
  verifyPassword,
} from "./server/security.mjs";
import { sendInviteEmail, sendResetEmail } from "./server/email.mjs";
import { createToken, hashToken, isTokenExpired, TOKEN_TTL_MS } from "./server/tokens.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnv(__dirname);

const PORT = Number(process.env.PORT || 3001);
// HAILTRACE_DATA_DIR is intended ONLY for tests. It lets the test harness
// point at a temp directory so it cannot read or clobber real account data.
// Production should never set it.
const DATA_DIR = process.env.HAILTRACE_DATA_DIR
  ? path.resolve(process.env.HAILTRACE_DATA_DIR)
  : path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

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
    sessionSecret: process.env.SESSION_SECRET || (IS_PRODUCTION ? "" : "local-dev-session-secret-change-me"),
    corsAllowedOrigins: String(
      process.env.CORS_ALLOWED_ORIGINS
      || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    allowDemoMode: String(process.env.ALLOW_DEMO_MODE || (!IS_PRODUCTION)).toLowerCase() === "true",
    customerioAppApiKey: process.env.CUSTOMERIO_APP_API_KEY || "",
    customerioRegion: (process.env.CUSTOMERIO_REGION || "us").toLowerCase(),
    customerioFromName: process.env.CUSTOMERIO_FROM_NAME || "",
    customerioInviteTemplateId: process.env.CUSTOMERIO_INVITE_TEMPLATE_ID || "",
    customerioResetTemplateId: process.env.CUSTOMERIO_RESET_TEMPLATE_ID || "",
    appPublicUrl: (process.env.APP_PUBLIC_URL || "http://localhost:5173").replace(/\/$/, ""),
  };
}

const CONFIG = buildConfig();

const app = express();

const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10, keyPrefix: "auth" });
const registerRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 20, keyPrefix: "register" });
const runTestRateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 30, keyPrefix: "run-test" });
const notificationRateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 20, keyPrefix: "notify" });
const jiraRateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 60, keyPrefix: "jira" });
// Invite/reset rate limits. Forgot-password is split into two so we can
// independently throttle "many resets for one email" (enumeration / harassment
// of one user) AND "many resets from one IP" (broad credential-bombing). Both
// limits are silent — the endpoint always returns 200 with the same body to
// prevent enumeration.
const inviteRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 20, keyPrefix: "invite" });
const forgotByEmailRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 5, keyPrefix: "forgot-email" });
const forgotByIpRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 10, keyPrefix: "forgot-ip" });
const consumeRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 10, keyPrefix: "consume" });
const tokenValidateRateLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyPrefix: "token-validate" });

app.use(applySecurityHeaders);
app.use(cors(buildCorsOptions(CONFIG.corsAllowedOrigins)));
app.use(express.json({ limit: "64kb" }));

function isSecureRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function getDemoAllowed() {
  return CONFIG.allowDemoMode;
}

function ensureDemoAllowed(res, feature) {
  if (getDemoAllowed()) return true;
  res.status(503).json({
    error: `${feature} is not configured. Demo mode is disabled in production.`,
  });
  return false;
}

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
    email: account.email,
    displayName: account.displayName,
    registeredAt: account.registeredAt,
    role: account.role || "tester",
    status: account.status || "active",
  };
}

function normalizeAccount(account) {
  return {
    email: String(account.email || "").trim().toLowerCase(),
    displayName: String(account.displayName || "").trim(),
    registeredAt: account.registeredAt,
    role: account.role === "admin" ? "admin" : "tester",
    passwordHash: account.passwordHash || "",
    passwordSalt: account.passwordSalt || "",
    status: account.status === "pending" ? "pending" : "active",
    sessionVersion: Number.isInteger(account.sessionVersion) ? account.sessionVersion : 0,
    pendingToken: account.pendingToken && typeof account.pendingToken === "object" ? account.pendingToken : null,
  };
}

function findAccountByEmail(accounts, email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  return accounts.find((account) => String(account.email || "").toLowerCase() === needle) || null;
}

async function assertAccountSchema() {
  const accounts = await readAccounts();
  if (accounts.length === 0) return;
  const offenders = accounts.filter((account) => !account || typeof account !== "object" || !account.email);
  if (offenders.length > 0) {
    console.error(
      "[startup] data/accounts.json contains accounts without an `email` field. "
      + "Run: node scripts/migrate-accounts-to-email.mjs --map \"<oldUsername>=<email>\" "
      + "and restart. Refusing to start.",
    );
    process.exit(1);
  }
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

function hasSessionSecret() {
  return Boolean(CONFIG.sessionSecret);
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

function ensureSessionSecret() {
  if (hasSessionSecret()) return;
  throw new Error("SESSION_SECRET is required. Generate a long random value for signed session cookies.");
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
  let text = requireNonEmptyString(description, "Description", { min: 3, max: 10000 });
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

function applyRateLimit(req, res, limiter, scope) {
  const ip = getClientIp(req);
  const key = req.user ? `${req.user.email}:${ip}` : ip;
  const result = limiter(key);
  if (result.ok) return true;
  res.setHeader("Retry-After", String(Math.ceil((result.retryAfterMs || 1000) / 1000)));
  res.status(429).json({ error: `Too many ${scope} requests. Please try again later.` });
  return false;
}

async function attachSession(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie || "");
  const sessionValue = req.cookies[getSessionCookieName()];
  req.session = hasSessionSecret() ? readSessionCookie(CONFIG.sessionSecret, sessionValue) : null;
  req.user = null;

  if (!req.session?.email) {
    next();
    return;
  }

  // Re-resolve the account on every request so that role changes, status
  // changes, and sessionVersion bumps take effect immediately. This is the
  // mechanism that closes the "demoted admin keeps admin power" window AND
  // gives password-reset/invite flows the ability to revoke all live
  // sessions for a user by incrementing sessionVersion.
  try {
    const accounts = (await readAccounts()).map(normalizeAccount);
    const account = findAccountByEmail(accounts, req.session.email);
    if (!account) {
      next();
      return;
    }
    if (account.status !== "active") {
      next();
      return;
    }
    if (account.sessionVersion !== req.session.sessionVersion) {
      next();
      return;
    }
    req.user = {
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      sessionVersion: account.sessionVersion,
    };
  } catch (error) {
    console.warn(`[auth] Failed to resolve session account: ${error.message}`);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user?.email) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

app.use(attachSession);

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
      demoModeAllowed: getDemoAllowed(),
      sessionConfigured: hasSessionSecret(),
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
  if (!applyRateLimit(req, res, authRateLimit, "login")) return undefined;
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const emailValue = validateEmail(email);
    const passwordValue = String(password);
    const accounts = (await readAccounts()).map(normalizeAccount);
    const match = findAccountByEmail(accounts, emailValue);

    // Authentication outcome is computed without revealing which case failed.
    // The generic 401 response handles "no account", "wrong password",
    // "pending account", and "corrupt record" with the same body so callers
    // cannot enumerate accounts by response shape.
    let authenticated = false;
    if (match && match.status === "active" && match.passwordHash && match.passwordSalt) {
      authenticated = await verifyPassword(passwordValue, match);
    }

    if (!authenticated) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    ensureSessionSecret();
    setSessionCookie(res, CONFIG.sessionSecret, match, isSecureRequest(req));
    return res.json({ account: sanitizeAccount(match) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Login failed." });
  }
});

app.post("/register", async (req, res) => {
  if (!applyRateLimit(req, res, registerRateLimit, "registration")) return undefined;
  try {
    const { email, displayName, password } = req.body || {};
    if (!email || !displayName || !password) {
      return res.status(400).json({ error: "Email, display name, and password are required." });
    }

    const emailValue = validateEmail(email);
    const displayNameValue = validateDisplayName(displayName);
    const passwordValue = validatePassword(password);
    const accounts = (await readAccounts()).map(normalizeAccount);
    const isBootstrap = accounts.length === 0;

    if (!isBootstrap) {
      if (!req.user?.email) {
        return res.status(401).json({ error: "An authenticated admin must create new users." });
      }
      if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Only admins can create users." });
      }
    }

    if (findAccountByEmail(accounts, emailValue)) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const passwordData = await hashPassword(passwordValue);
    const account = {
      email: emailValue,
      displayName: displayNameValue,
      role: isBootstrap ? "admin" : "tester",
      status: "active",
      sessionVersion: 0,
      pendingToken: null,
      ...passwordData,
      registeredAt: new Date().toISOString(),
    };

    accounts.push(account);
    await writeAccounts(accounts);
    if (isBootstrap) {
      ensureSessionSecret();
      setSessionCookie(res, CONFIG.sessionSecret, account, isSecureRequest(req));
    }
    return res.status(201).json({ account: sanitizeAccount(account) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Registration failed." });
  }
});

app.post("/logout", requireAuth, (req, res) => {
  clearSessionCookie(res, isSecureRequest(req));
  res.status(204).send();
});

app.get("/session", (req, res) => {
  if (!req.user?.email) {
    return res.json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    account: {
      email: req.user.email,
      displayName: req.user.displayName,
      role: req.user.role || "tester",
    },
  });
});

app.get("/accounts", requireAuth, requireAdmin, async (_req, res) => {
  const accounts = (await readAccounts()).map(normalizeAccount);
  res.json(accounts.map(sanitizeAccount));
});

// ---------------------------------------------------------------------------
// Invite + password-reset flows
//
// Security invariants enforced below:
//  * Tokens are 32 random bytes, sha256-hashed at rest, single-use, time-
//    limited, and verified with timing-safe comparison (see server/tokens.mjs).
//  * /forgot-password always returns 200 with the same body regardless of
//    whether the email exists, the rate limit was hit, or the input was
//    invalid. No user enumeration via this endpoint.
//  * Successful password change ALWAYS bumps sessionVersion, which invalidates
//    every existing cookie for that account on the next request (see
//    attachSession). This is the M4 fix from the auth audit.
//  * /invite is fail-closed: the persisted change only lands on disk after
//    Customer.io has accepted the message. A failing email cannot create an
//    orphan account whose owner never receives a link.
//  * The raw token only ever appears in the email URL and in memory during
//    request processing. data/accounts.json stores the sha256 hash.
// ---------------------------------------------------------------------------

function findAccountByTokenHash(accounts, tokenHash, expectedPurpose) {
  if (!tokenHash) return null;
  return accounts.find((account) => {
    const record = account.pendingToken;
    if (!record || record.hash !== tokenHash) return false;
    if (record.purpose !== expectedPurpose) return false;
    if (isTokenExpired(record)) return false;
    return true;
  }) || null;
}

function buildAcceptInviteUrl(rawToken) {
  return `${CONFIG.appPublicUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
}

function buildResetUrl(rawToken) {
  return `${CONFIG.appPublicUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

app.post("/invite", requireAuth, requireAdmin, async (req, res) => {
  if (!applyRateLimit(req, res, inviteRateLimit, "invitation")) return undefined;
  try {
    const { email, displayName } = req.body || {};
    if (!email || !displayName) {
      return res.status(400).json({ error: "Email and display name are required." });
    }
    const emailValue = validateEmail(email);
    const displayNameValue = validateDisplayName(displayName);

    const accounts = (await readAccounts()).map(normalizeAccount);
    const existing = findAccountByEmail(accounts, emailValue);
    if (existing && existing.status === "active") {
      return res.status(409).json({ error: "An active account already exists for this email." });
    }

    const { raw: rawToken, record } = createToken("invite");
    const expiresInHours = Math.round(TOKEN_TTL_MS.invite / 3_600_000);
    const now = new Date().toISOString();

    const nextAccount = existing
      ? {
        ...existing,
        displayName: displayNameValue,
        pendingToken: record,
      }
      : {
        email: emailValue,
        displayName: displayNameValue,
        role: "tester",
        status: "pending",
        sessionVersion: 0,
        pendingToken: record,
        passwordHash: "",
        passwordSalt: "",
        registeredAt: now,
      };

    // Send email FIRST so a delivery failure prevents any account from being
    // persisted. The raw token only exists in the email URL and in memory.
    try {
      await sendInviteEmail(CONFIG, {
        to: emailValue,
        displayName: displayNameValue,
        inviteUrl: buildAcceptInviteUrl(rawToken),
        expiresInHours,
      });
    } catch (error) {
      console.warn(`[invite] Could not send invite to ${emailValue}: ${error.message}`);
      return res.status(502).json({ error: "Could not send invite email. Please try again." });
    }

    const nextAccounts = existing
      ? accounts.map((account) => account.email === existing.email ? nextAccount : account)
      : [...accounts, nextAccount];
    await writeAccounts(nextAccounts);

    return res.status(201).json({ account: sanitizeAccount(nextAccount) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invite failed." });
  }
});

app.get("/invite/:token", async (req, res) => {
  if (!applyRateLimit(req, res, tokenValidateRateLimit, "token validation")) return undefined;
  const rawToken = String(req.params.token || "");
  const tokenHash = rawToken ? hashToken(rawToken) : null;
  const accounts = (await readAccounts()).map(normalizeAccount);
  const match = findAccountByTokenHash(accounts, tokenHash, "invite");
  if (!match) return res.json({ valid: false });
  return res.json({
    valid: true,
    email: match.email,
    displayName: match.displayName,
    expiresAt: match.pendingToken.expiresAt,
  });
});

app.post("/accept-invite", async (req, res) => {
  if (!applyRateLimit(req, res, consumeRateLimit, "invite acceptance")) return undefined;
  try {
    const { token, password, displayName } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Token and password are required." });
    }
    const passwordValue = validatePassword(password);
    const trimmedDisplayName = typeof displayName === "string" && displayName.trim()
      ? validateDisplayName(displayName)
      : null;

    const tokenHash = hashToken(String(token));
    const accounts = (await readAccounts()).map(normalizeAccount);
    const match = findAccountByTokenHash(accounts, tokenHash, "invite");
    if (!match) {
      return res.status(400).json({ error: "This invite link is invalid or has expired." });
    }

    const passwordData = await hashPassword(passwordValue);
    const updated = {
      ...match,
      ...passwordData,
      status: "active",
      pendingToken: null,
      displayName: trimmedDisplayName || match.displayName,
      sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
    };

    await writeAccounts(accounts.map((account) => account.email === match.email ? updated : account));
    ensureSessionSecret();
    setSessionCookie(res, CONFIG.sessionSecret, updated, isSecureRequest(req));
    return res.status(200).json({ account: sanitizeAccount(updated) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Could not accept invite." });
  }
});

app.post("/forgot-password", async (req, res) => {
  // This endpoint is intentionally chatty in successful logs and silent in
  // its HTTP response. It ALWAYS returns 200 with the same body so attackers
  // can't enumerate accounts or rate-limit state from the outside.
  const respondOk = () => res.json({ ok: true });

  const ip = getClientIp(req);
  if (!forgotByIpRateLimit(ip).ok) {
    console.warn(`[forgot-password] IP rate limit hit for ${ip}`);
    return respondOk();
  }

  let emailValue = "";
  try {
    emailValue = validateEmail(String(req.body?.email || ""));
  } catch {
    return respondOk();
  }

  if (!forgotByEmailRateLimit(emailValue).ok) {
    console.warn(`[forgot-password] Email rate limit hit for ${emailValue}`);
    return respondOk();
  }

  const accounts = (await readAccounts()).map(normalizeAccount);
  const match = findAccountByEmail(accounts, emailValue);
  if (!match || match.status !== "active") {
    return respondOk();
  }

  const { raw: rawToken, record } = createToken("reset");
  const updated = { ...match, pendingToken: record };
  await writeAccounts(accounts.map((account) => account.email === match.email ? updated : account));

  const expiresInHours = Math.max(1, Math.round(TOKEN_TTL_MS.reset / 3_600_000));
  try {
    await sendResetEmail(CONFIG, {
      to: match.email,
      displayName: match.displayName,
      resetUrl: buildResetUrl(rawToken),
      expiresInHours,
    });
  } catch (error) {
    // We intentionally do not surface delivery failures here. The user must
    // not learn whether their email exists. They will simply not receive a
    // message. Operators see the failure in server logs.
    console.warn(`[forgot-password] Send failed for ${match.email}: ${error.message}`);
  }
  return respondOk();
});

app.get("/reset/:token", async (req, res) => {
  if (!applyRateLimit(req, res, tokenValidateRateLimit, "token validation")) return undefined;
  const rawToken = String(req.params.token || "");
  const tokenHash = rawToken ? hashToken(rawToken) : null;
  const accounts = (await readAccounts()).map(normalizeAccount);
  const match = findAccountByTokenHash(accounts, tokenHash, "reset");
  if (!match) return res.json({ valid: false });
  return res.json({
    valid: true,
    email: match.email,
    displayName: match.displayName,
    expiresAt: match.pendingToken.expiresAt,
  });
});

app.post("/reset-password", async (req, res) => {
  if (!applyRateLimit(req, res, consumeRateLimit, "password reset")) return undefined;
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: "Token and password are required." });
    }
    const passwordValue = validatePassword(password);

    const tokenHash = hashToken(String(token));
    const accounts = (await readAccounts()).map(normalizeAccount);
    const match = findAccountByTokenHash(accounts, tokenHash, "reset");
    if (!match) {
      return res.status(400).json({ error: "This reset link is invalid or has expired." });
    }

    const passwordData = await hashPassword(passwordValue);
    const updated = {
      ...match,
      ...passwordData,
      pendingToken: null,
      // Bumping sessionVersion invalidates every existing cookie for this
      // account on the next request, including any session a hijacker may
      // have. The user must log in fresh with their new password.
      sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
    };

    await writeAccounts(accounts.map((account) => account.email === match.email ? updated : account));
    // Do NOT issue a session cookie. Reset is not the same as login; the user
    // must explicitly authenticate with their new credentials.
    return res.status(204).send();
  } catch (error) {
    return res.status(400).json({ error: error.message || "Could not reset password." });
  }
});

app.delete("/accounts/:email", requireAuth, requireAdmin, async (req, res) => {
  let emailValue;
  try {
    emailValue = validateEmail(decodeURIComponent(String(req.params.email || "")));
  } catch {
    return res.status(400).json({ error: "Invalid email." });
  }
  const accounts = (await readAccounts()).map(normalizeAccount);
  const target = findAccountByEmail(accounts, emailValue);
  if (!target) {
    return res.status(404).json({ error: "Account not found." });
  }
  if (target.role === "admin") {
    const adminCount = accounts.filter((account) => account.role === "admin").length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: "Cannot remove the last admin account." });
    }
  }
  const nextAccounts = accounts.filter((account) => account.email !== target.email);
  await writeAccounts(nextAccounts);
  return res.status(204).send();
});

app.post("/run-test", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, runTestRateLimit, "test execution")) return undefined;
  let text;
  let ticketKey;
  try {
    const { description, jiraKey } = req.body || {};
    if (!description) {
      return res.status(400).json({ error: "Description is required." });
    }
    const resolved = await resolveTestInput(description, jiraKey);
    text = resolved.text;
    ticketKey = resolved.ticketKey;
  } catch (error) {
    return res.status(400).json({ error: error.message || "Invalid test request." });
  }

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

  if (!ensureDemoAllowed(res, "HailTrace QA")) return undefined;
  return res.json(buildMockAnalysis(text, ticketKey));
});

app.get("/jira/issue/:key", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, jiraRateLimit, "Jira")) return undefined;
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

  if (!ensureDemoAllowed(res, "Jira")) return undefined;
  return res.json({
    key,
    summary: `Demo Jira ticket ${key}`,
    description: "Demo mode ticket. Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to .env for live Jira.",
    acceptanceCriteria: "Configure Jira credentials in .env to load real ticket details.",
  });
});

app.post("/notifications/slack", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, notificationRateLimit, "notification")) return undefined;
  const { description, status, verdict } = req.body || {};

  if (hasRealSlackConfig()) {
    try {
      const result = await sendSlackWebhook(CONFIG, { description, status, verdict });
      return res.json(result);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  if (!ensureDemoAllowed(res, "Slack")) return undefined;
  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    description: description || "",
    status: status || "",
    verdict: verdict || "",
  });
});

app.post("/notifications/slack/test", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, notificationRateLimit, "notification")) return undefined;
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

  if (!ensureDemoAllowed(res, "Slack")) return undefined;
  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    message: "Demo mode: Slack test accepted. Add SLACK_WEBHOOK_URL to .env to send for real.",
  });
});

app.post("/notifications/zoho-cliq", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, notificationRateLimit, "notification")) return undefined;
  const { description, status, verdict } = req.body || {};

  if (hasRealZohoCliqConfig()) {
    try {
      const result = await sendZohoCliqWebhook(CONFIG, { description, status, verdict });
      return res.json(result);
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  if (!ensureDemoAllowed(res, "Zoho Cliq")) return undefined;
  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    description: description || "",
    status: status || "",
    verdict: verdict || "",
  });
});

app.post("/notifications/zoho-cliq/test", requireAuth, async (req, res) => {
  if (!applyRateLimit(req, res, notificationRateLimit, "notification")) return undefined;
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

  if (!ensureDemoAllowed(res, "Zoho Cliq")) return undefined;
  return res.json({
    ok: true,
    mode: "demo",
    delivered: true,
    message: "Demo mode: Zoho Cliq test accepted. Add ZOHO_CLIQ_WEBHOOK_URL to .env to send for real.",
  });
});

app.use((error, _req, res, _next) => {
  console.error(`[server] ${error.message}`);
  if (res.headersSent) return undefined;
  if (String(error.message || "").includes("CORS")) {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  return res.status(500).json({ error: "Internal server error." });
});

await assertAccountSchema();

// Allow tests to import server.js without the side-effect of binding a port
// (set HAILTRACE_TEST_MODE=1 in test runners; see tests/auth-flow.test.mjs).
// In normal runtime nothing changes — the server still binds PORT.
export { app };

if (!process.env.HAILTRACE_TEST_MODE) {
  app.listen(PORT, () => {
    validateConfig();
    if (IS_PRODUCTION && !hasSessionSecret()) {
      console.error("SESSION_SECRET is required in production.");
      process.exit(1);
    }
    console.log(`HailTrace QA backend listening on http://localhost:${PORT}`);
    console.log(`Mode: ${getRuntimeMode()}`);
    console.log(`  HailTrace QA: ${hasRealHailTraceConfig() ? "live" : "demo"}`);
    console.log(`  Jira:         ${hasRealJiraConfig() ? "live" : "demo"}`);
    console.log(`  Slack:        ${hasRealSlackConfig() ? "live" : "demo"}`);
    console.log(`  Zoho Cliq:    ${hasRealZohoCliqConfig() ? "live" : "demo"}`);
    console.log(`  OpenAI:       ${hasOpenAiConfig() ? "live" : "demo"}`);
    console.log(`  Demo mode:    ${getDemoAllowed() ? "enabled" : "disabled"}`);
  });
}
