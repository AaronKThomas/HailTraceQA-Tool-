// Composition root.
//
// createApp(config) wires every dependency in one place. server.js is now
// only responsible for loading env, building config, and binding a port.
// Tests can call createApp(testConfig) directly without spinning up a
// process or touching real files.

import cors from "cors";
import express from "express";
import path from "node:path";
import { applySecurityHeaders, buildCorsOptions } from "./security.mjs";
import { createAccountRepository } from "./accountsRepository.mjs";
import { createRateLimiters } from "./rateLimiters.mjs";
import { createClientIpMiddleware, createSessionMiddleware } from "./middleware.mjs";
import { registerHealthRoutes } from "./routes/health.mjs";
import { registerAuthRoutes } from "./routes/auth.mjs";
import { registerAdminAccountRoutes } from "./routes/adminAccounts.mjs";
import { registerInviteResetRoutes } from "./routes/inviteReset.mjs";
import { registerRunTestRoutes } from "./routes/runTest.mjs";
import { registerJiraRoutes } from "./routes/jira.mjs";
import { registerNotificationRoutes } from "./routes/notifications.mjs";
import { registerTestArtifactRoutes } from "./routes/testArtifacts.mjs";

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createApp(config) {
  const appConfig = {
    ...config,
    testArtifactsDir: config.testArtifactsDir || path.join(config.dataDir, "test-artifacts"),
    testReplayRecordingEnabled: config.testReplayRecordingEnabled !== false,
    testReplayRetentionMs: positiveNumber(config.testReplayRetentionMs, 7 * 24 * 60 * 60 * 1000),
  };
  const accounts = createAccountRepository({ dataDir: appConfig.dataDir });
  const rateLimits = createRateLimiters();
  const attachSession = createSessionMiddleware({ config: appConfig, accounts });

  const app = express();
  app.use(applySecurityHeaders);
  app.use(cors(buildCorsOptions(appConfig.corsAllowedOrigins)));
  app.use(express.json({ limit: "64kb" }));
  app.use(createClientIpMiddleware({ config: appConfig }));
  app.use(attachSession);

  const deps = { config: appConfig, accounts, rateLimits };
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerAdminAccountRoutes(app, deps);
  registerInviteResetRoutes(app, deps);
  registerRunTestRoutes(app, deps);
  registerJiraRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerTestArtifactRoutes(app, deps);

  app.use((error, _req, res, _next) => {
    console.error(`[server] ${error.message}`);
    if (res.headersSent) return undefined;
    if (String(error.message || "").includes("CORS")) {
      return res.status(403).json({ error: "Origin not allowed." });
    }
    return res.status(500).json({ error: "Internal server error." });
  });

  return { app, accounts };
}
