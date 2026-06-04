// Public health endpoints. Intentionally unauthenticated so operators and
// the frontend can probe runtime mode without a session.

import {
  hasOpenAiConfig,
  hasRealJiraConfig,
  hasRealSlackConfig,
  hasRealZohoCliqConfig,
  hasSessionSecret,
  hasTargetSiteAuthConfig,
  getRuntimeMode,
} from "../config.mjs";
import {
  probeJira,
  probeOpenAi,
  probeSlack,
  probeZohoCliq,
  safeHostname,
} from "../probes.mjs";

export function registerHealthRoutes(app, { config }) {
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "hailtrace-qa-local-backend",
      mode: getRuntimeMode(config),
      integrations: {
        websiteQa: "local",
        jira: hasRealJiraConfig(config) ? "live" : "demo",
        slack: hasRealSlackConfig(config) ? "live" : "demo",
        openai: hasOpenAiConfig(config) ? "live" : "demo",
        zohoCliq: hasRealZohoCliqConfig(config) ? "live" : "demo",
      },
      details: {
        openaiModel: hasOpenAiConfig(config) ? config.openaiModel : null,
        jiraHost: safeHostname(config.jiraBaseUrl),
        targetSiteAuthConfigured: hasTargetSiteAuthConfig(config),
        slackConfigured: hasRealSlackConfig(config),
        zohoCliqConfigured: hasRealZohoCliqConfig(config),
        demoModeAllowed: config.allowDemoMode,
        sessionConfigured: hasSessionSecret(config),
      },
    });
  });

  app.get("/health/integrations", async (_req, res) => {
    const [openai, jira] = await Promise.all([
      probeOpenAi(config),
      probeJira(config),
    ]);
    res.json({
      integrations: {
        openai,
        websiteQa: {
          state: "local",
          message: hasTargetSiteAuthConfig(config)
            ? "Local Playwright runner with target-site auth configured"
            : "Local Playwright runner; target-site auth not configured",
        },
        jira,
        slack: probeSlack(config),
        zohoCliq: probeZohoCliq(config),
      },
      checkedAt: new Date().toISOString(),
    });
  });
}
