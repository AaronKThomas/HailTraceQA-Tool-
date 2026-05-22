// Composition root.
//
// createApp(config) wires every dependency in one place. server.js is now
// only responsible for loading env, building config, and binding a port.
// Tests can call createApp(testConfig) directly without spinning up a
// process or touching real files.

import cors from "cors";
import express from "express";
import { applySecurityHeaders, buildCorsOptions } from "./security.mjs";
import { createAccountRepository } from "./accountsRepository.mjs";
import { createRateLimiters } from "./rateLimiters.mjs";
import { createSessionMiddleware } from "./middleware.mjs";
import { registerHealthRoutes } from "./routes/health.mjs";
import { registerAuthRoutes } from "./routes/auth.mjs";
import { registerAdminAccountRoutes } from "./routes/adminAccounts.mjs";
import { registerInviteResetRoutes } from "./routes/inviteReset.mjs";
import { registerRunTestRoutes } from "./routes/runTest.mjs";
import { registerJiraRoutes } from "./routes/jira.mjs";
import { registerNotificationRoutes } from "./routes/notifications.mjs";

export function createApp(config) {
  const accounts = createAccountRepository({ dataDir: config.dataDir });
  const rateLimits = createRateLimiters();
  const attachSession = createSessionMiddleware({ config, accounts });

  const app = express();
  app.use(applySecurityHeaders);
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
  app.use(express.json({ limit: "64kb" }));
  app.use(attachSession);

  const deps = { config, accounts, rateLimits };
  registerHealthRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerAdminAccountRoutes(app, deps);
  registerInviteResetRoutes(app, deps);
  registerRunTestRoutes(app, deps);
  registerJiraRoutes(app, deps);
  registerNotificationRoutes(app, deps);

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
