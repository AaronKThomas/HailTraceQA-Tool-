import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../server/loadEnv.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

await loadEnv(rootDir);

function yesNo(value) {
  return value ? "yes" : "no";
}

async function readJsonIfPresent(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const packageJson = await readJsonIfPresent(path.join(rootDir, "package.json"));
const accounts = await readJsonIfPresent(path.join(rootDir, "data", "accounts.json"));
const buildPresent = await fs.access(path.join(rootDir, "dist")).then(() => true).catch(() => false);

const accountCount = Array.isArray(accounts) ? accounts.length : 0;
const adminCount = Array.isArray(accounts)
  ? accounts.filter((account) => (account.role || "tester") === "admin").length
  : 0;

console.log("Internal publish checklist");
console.log("");
console.log("Environment");
console.log(`- NODE_ENV: ${process.env.NODE_ENV || "(unset)"}`);
console.log(`- SESSION_SECRET set: ${yesNo(Boolean(process.env.SESSION_SECRET))}`);
console.log(`- CORS_ALLOWED_ORIGINS set: ${yesNo(Boolean(process.env.CORS_ALLOWED_ORIGINS))}`);
console.log(`- ALLOW_DEMO_MODE: ${process.env.ALLOW_DEMO_MODE || "(unset)"}`);
console.log("");
console.log("Integrations");
console.log(`- OpenAI configured: ${yesNo(Boolean(process.env.OPENAI_API_KEY))}`);
console.log(`- HailTrace configured: ${yesNo(Boolean(process.env.HAILTRACE_API_BASE_URL && process.env.HAILTRACE_API_KEY))}`);
console.log(`- Jira configured: ${yesNo(Boolean(process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN))}`);
console.log(`- Slack configured: ${yesNo(Boolean(process.env.SLACK_WEBHOOK_URL))}`);
console.log(`- Zoho Cliq configured: ${yesNo(Boolean(process.env.ZOHO_CLIQ_WEBHOOK_URL))}`);
console.log("");
console.log("Workspace state");
console.log(`- dist/ present: ${yesNo(buildPresent)}`);
console.log(`- package version: ${packageJson?.version || "(unknown)"}`);
console.log(`- test script present: ${yesNo(Boolean(packageJson?.scripts?.test))}`);
console.log(`- accounts file present: ${yesNo(Array.isArray(accounts))}`);
console.log(`- user count: ${accountCount}`);
console.log(`- admin count: ${adminCount}`);
if (accountCount > 0 && adminCount === 0) {
  console.log("- note: legacy account data detected with no admin role; start the hardened server once to auto-promote the first account.");
}
console.log("");
console.log("Manual checks before publish");
console.log("- Run: npm test");
console.log("- Run: npm run build");
console.log("- Run: npm run check:prod");
console.log("- Verify first admin bootstrap or existing admin login.");
console.log("- Verify sign in, sign out, run-test, and admin user creation/removal flows.");
console.log("- Verify demo mode is disabled for the deployed environment.");
