// Local production-mode launcher for the HailTrace QA backend.
//
// Why this file exists:
// Running the server with NODE_ENV=production locally requires several
// preconditions (an .env.production with real values, no placeholder
// SESSION_SECRET, an explicit CORS allow-list, demo mode disabled).
// Forgetting any of them is how vibe-coded apps ship insecure configs.
// This script enforces those preconditions and fails closed if anything
// is missing. It never auto-creates secrets and never echoes secret values.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

function info(message) {
  console.log(`[start:prod] ${message}`);
}

function fail(message) {
  console.error(`[start:prod] ERROR: ${message}`);
  process.exit(1);
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runChild(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`Child terminated by signal ${signal}`));
      if (code !== 0) return reject(new Error(`Child exited with code ${code}`));
      resolve();
    });
  });
}

const envProductionPath = path.join(rootDir, ".env.production");
if (!(await exists(envProductionPath))) {
  fail(
    ".env.production not found. Create it (gitignored) with at minimum:\n"
    + "        SESSION_SECRET=<openssl rand -hex 32>\n"
    + "        CORS_ALLOWED_ORIGINS=https://your-real-frontend\n"
    + "        ALLOW_DEMO_MODE=false\n"
    + "      plus any real API keys you need.",
  );
}
info(".env.production found.");

const childEnv = { ...process.env, NODE_ENV: "production" };

info("Running production readiness check...");
try {
  await runChild(process.execPath, ["scripts/check-production-readiness.mjs"], childEnv);
} catch (error) {
  fail(`Production readiness check failed. ${error.message}`);
}
info("Production readiness check passed.");

info("Starting backend with NODE_ENV=production on this terminal.");
info("Press Ctrl+C to stop.");
try {
  await runChild(process.execPath, ["server.js"], childEnv);
} catch (error) {
  fail(`Server exited unexpectedly. ${error.message}`);
}
