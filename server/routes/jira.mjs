// Jira proxy. The frontend never talks to Jira directly so credentials and
// logging stay behind one trust boundary.

import { applyRateLimit, ensureDemoAllowed, requireAuth } from "../middleware.mjs";
import { hasRealJiraConfig } from "../config.mjs";
import { fetchJiraIssue } from "../integrations.mjs";

export function registerJiraRoutes(app, { config, rateLimits }) {
  app.get("/jira/issue/:key", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.jira, "Jira")) return undefined;
    const key = String(req.params.key || "").toUpperCase();
    if (!key) {
      return res.status(400).json({ error: "Issue key is required." });
    }

    if (hasRealJiraConfig(config)) {
      try {
        const issue = await fetchJiraIssue(config, key);
        return res.json(issue);
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

    if (!ensureDemoAllowed(config, res, "Jira")) return undefined;
    return res.json({
      key,
      summary: `Demo Jira ticket ${key}`,
      description: "Demo mode ticket. Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to .env for live Jira.",
      acceptanceCriteria: "Configure Jira credentials in .env to load real ticket details.",
    });
  });
}
