import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../server/loadEnv.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

await loadEnv(rootDir);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function requireEnv(name, { validate, message } = {}) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    fail(`${name} is required.`);
    return "";
  }
  if (validate && !validate(value)) {
    fail(message || `${name} is invalid.`);
    return value;
  }
  pass(`${name} is set.`);
  return value;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

console.log("Checking production readiness...");

const nodeEnv = String(process.env.NODE_ENV || "").trim();
if (nodeEnv !== "production") {
  fail("NODE_ENV must be set to production.");
} else {
  pass("NODE_ENV is production.");
}

requireEnv("SESSION_SECRET", {
  validate: (value) => value.length >= 32 && !value.includes("change-me"),
  message: "SESSION_SECRET must be at least 32 characters and not use the default placeholder.",
});

requireEnv("CORS_ALLOWED_ORIGINS", {
  validate: (value) => !value.includes("*"),
  message: "CORS_ALLOWED_ORIGINS must not contain '*'. Use explicit internal origins.",
});

const allowDemoMode = String(process.env.ALLOW_DEMO_MODE || "").toLowerCase();
if (allowDemoMode === "true") {
  fail("ALLOW_DEMO_MODE must be false for production publish.");
} else {
  pass("Demo mode is disabled for production.");
}

const openAiConfigured = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
const hailtraceConfigured = Boolean(String(process.env.HAILTRACE_API_BASE_URL || "").trim() && String(process.env.HAILTRACE_API_KEY || "").trim());
const jiraConfigured = Boolean(
  String(process.env.JIRA_BASE_URL || "").trim()
  && String(process.env.JIRA_EMAIL || "").trim()
  && String(process.env.JIRA_API_TOKEN || "").trim(),
);

const appPublicUrl = String(process.env.APP_PUBLIC_URL || "").trim();
if (!appPublicUrl || !/^https:\/\//.test(appPublicUrl)) {
  fail("APP_PUBLIC_URL is required in production and must be an https:// URL. It is used to build invite and reset links.");
} else {
  pass("APP_PUBLIC_URL is set.");
}

const cioApiKey = String(process.env.CUSTOMERIO_APP_API_KEY || "").trim();
const cioInvite = String(process.env.CUSTOMERIO_INVITE_TEMPLATE_ID || "").trim();
const cioReset = String(process.env.CUSTOMERIO_RESET_TEMPLATE_ID || "").trim();
if (!cioApiKey || cioApiKey.startsWith("replace_") || !cioInvite || cioInvite.startsWith("replace_") || !cioReset || cioReset.startsWith("replace_")) {
  fail("Customer.io is not fully configured. Set CUSTOMERIO_APP_API_KEY, CUSTOMERIO_INVITE_TEMPLATE_ID, and CUSTOMERIO_RESET_TEMPLATE_ID to real values (not placeholders).");
} else {
  pass("Customer.io is configured.");
}

if (openAiConfigured) pass("OpenAI integration is configured.");
else warn("OpenAI integration is not configured.");

if (hailtraceConfigured) pass("HailTrace integration is configured.");
else warn("HailTrace integration is not configured.");

if (jiraConfigured) pass("Jira integration is configured.");
else warn("Jira integration is not configured.");

const dataDir = path.join(rootDir, "data");
const accountsFile = path.join(dataDir, "accounts.json");

if (await fileExists(dataDir)) {
  pass("data/ directory exists.");
} else {
  warn("data/ directory does not exist yet. It will be created at runtime.");
}

if (await fileExists(accountsFile)) {
  pass("data/accounts.json exists.");
  try {
    const accounts = JSON.parse(await fs.readFile(accountsFile, "utf8"));
    if (Array.isArray(accounts) && accounts.length > 0) {
      const adminCount = accounts.filter((account) => (account.role || "tester") === "admin").length;
      if (adminCount === 0) {
        fail("No admin role is present in data/accounts.json. Either delete the file and let the first /register call bootstrap a fresh admin, or manually edit one account's `role` field to `\"admin\"`. The server no longer auto-promotes on startup (see H1 in the auth audit).");
      } else {
        pass(`Admin account present (${adminCount}).`);
      }
    }
  } catch {
    warn("Could not inspect data/accounts.json for admin bootstrap state.");
  }
} else {
  warn("data/accounts.json does not exist yet. First registration will bootstrap the admin account.");
}

const distDir = path.join(rootDir, "dist");
if (await fileExists(distDir)) {
  pass("dist/ build output exists.");
} else {
  warn("dist/ build output is missing. Run npm run build before deploy.");
}

if (process.exitCode) {
  console.error("Production readiness check failed.");
} else {
  console.log("Production readiness check passed.");
}
