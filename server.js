// Process entrypoint.
//
// Responsibilities are intentionally narrow:
//   1. Load env
//   2. Build config
//   3. Build the app (see server/app.mjs)
//   4. Validate on-disk schema
//   5. Bind a port (unless HAILTRACE_TEST_MODE=1)
//
// All routes, middleware, and business logic live under server/. Tests
// import { app } from this file so HAILTRACE_TEST_MODE must remain the gate
// that prevents listen() from running at module load.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./server/app.mjs";
import {
  buildConfig,
  getRuntimeMode,
  hasOpenAiConfig,
  hasRealHailTraceConfig,
  hasRealJiraConfig,
  hasRealSlackConfig,
  hasRealZohoCliqConfig,
  hasSessionSecret,
  warnOnPartialConfig,
} from "./server/config.mjs";
import { loadEnv } from "./server/loadEnv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnv(__dirname);

const config = buildConfig({ rootDir: __dirname });
const { app, accounts } = createApp(config);

await accounts.assertSchema();

export { app };

if (!process.env.HAILTRACE_TEST_MODE) {
  app.listen(config.port, () => {
    warnOnPartialConfig(config);
    if (config.isProduction && !hasSessionSecret(config)) {
      console.error("SESSION_SECRET is required in production.");
      process.exit(1);
    }
    console.log(`HailTrace QA backend listening on http://localhost:${config.port}`);
    console.log(`Mode: ${getRuntimeMode(config)}`);
    console.log(`  HailTrace QA: ${hasRealHailTraceConfig(config) ? "live" : "demo"}`);
    console.log(`  Jira:         ${hasRealJiraConfig(config) ? "live" : "demo"}`);
    console.log(`  Slack:        ${hasRealSlackConfig(config) ? "live" : "demo"}`);
    console.log(`  Zoho Cliq:    ${hasRealZohoCliqConfig(config) ? "live" : "demo"}`);
    console.log(`  OpenAI:       ${hasOpenAiConfig(config) ? "live" : "demo"}`);
    console.log(`  Demo mode:    ${config.allowDemoMode ? "enabled" : "disabled"}`);
  });
}
