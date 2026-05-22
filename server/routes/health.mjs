// Public health endpoints. Intentionally unauthenticated so operators and
// the frontend can probe runtime mode without a session.

import {
  hasOpenAiConfig,
  hasRealHailTraceConfig,
  hasRealJiraConfig,
  hasRealSlackConfig,
  hasRealZohoCliqConfig,
  hasSessionSecret,
  getRuntimeMode,
} from "../config.mjs";
import {
  probeHailTrace,
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
        hailtrace: hasRealHailTraceConfig(config) ? "live" : "demo",
        jira: hasRealJiraConfig(config) ? "live" : "demo",
        slack: hasRealSlackConfig(config) ? "live" : "demo",
        openai: hasOpenAiConfig(config) ? "live" : "demo",
        zohoCliq: hasRealZohoCliqConfig(config) ? "live" : "demo",
      },
      details: {
        openaiModel: hasOpenAiConfig(config) ? config.openaiModel : null,
        hailtraceHost: safeHostname(config.hailtraceApiBaseUrl),
        hailtraceQaPath: config.hailtraceQaPath,
        jiraHost: safeHostname(config.jiraBaseUrl),
        slackConfigured: hasRealSlackConfig(config),
        zohoCliqConfigured: hasRealZohoCliqConfig(config),
        demoModeAllowed: config.allowDemoMode,
        sessionConfigured: hasSessionSecret(config),
      },
    });
  });

  app.get("/health/integrations", async (_req, res) => {
    const [openai, hailtrace, jira] = await Promise.all([
      probeOpenAi(config),
      probeHailTrace(config),
      probeJira(config),
    ]);
    res.json({
      integrations: {
        openai,
        hailtrace,
        jira,
        slack: probeSlack(config),
        zohoCliq: probeZohoCliq(config),
      },
      checkedAt: new Date().toISOString(),
    });
  });
}
