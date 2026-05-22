// Slack and Zoho Cliq notification endpoints.
//
// Both follow the same shape: a real-send variant (driven by the test
// result) and a /test variant for the Settings page connectivity check.
// All return a demo-mode response when the corresponding webhook URL is
// not configured AND demo mode is allowed.

import { applyRateLimit, ensureDemoAllowed, requireAuth } from "../middleware.mjs";
import { hasRealSlackConfig, hasRealZohoCliqConfig } from "../config.mjs";
import { sendSlackWebhook, sendZohoCliqWebhook } from "../integrations.mjs";

function demoNotificationResponse({ description, status, verdict }) {
  return {
    ok: true,
    mode: "demo",
    delivered: true,
    description: description || "",
    status: status || "",
    verdict: verdict || "",
  };
}

export function registerNotificationRoutes(app, { config, rateLimits }) {
  app.post("/notifications/slack", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.notification, "notification")) return undefined;
    const { description, status, verdict } = req.body || {};

    if (hasRealSlackConfig(config)) {
      try {
        const result = await sendSlackWebhook(config, { description, status, verdict });
        return res.json(result);
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

    if (!ensureDemoAllowed(config, res, "Slack")) return undefined;
    return res.json(demoNotificationResponse({ description, status, verdict }));
  });

  app.post("/notifications/slack/test", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.notification, "notification")) return undefined;
    if (hasRealSlackConfig(config)) {
      try {
        const result = await sendSlackWebhook(config, {
          message: "HailTrace QA test notification — your Slack webhook is connected.",
        });
        return res.json({ ...result, message: "Test notification sent to Slack." });
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

    if (!ensureDemoAllowed(config, res, "Slack")) return undefined;
    return res.json({
      ok: true,
      mode: "demo",
      delivered: true,
      message: "Demo mode: Slack test accepted. Add SLACK_WEBHOOK_URL to .env to send for real.",
    });
  });

  app.post("/notifications/zoho-cliq", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.notification, "notification")) return undefined;
    const { description, status, verdict } = req.body || {};

    if (hasRealZohoCliqConfig(config)) {
      try {
        const result = await sendZohoCliqWebhook(config, { description, status, verdict });
        return res.json(result);
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

    if (!ensureDemoAllowed(config, res, "Zoho Cliq")) return undefined;
    return res.json(demoNotificationResponse({ description, status, verdict }));
  });

  app.post("/notifications/zoho-cliq/test", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.notification, "notification")) return undefined;
    if (hasRealZohoCliqConfig(config)) {
      try {
        const result = await sendZohoCliqWebhook(config, {
          message: "HailTrace QA test notification — your Zoho Cliq webhook is connected.",
        });
        return res.json({ ...result, message: "Test notification sent to Zoho Cliq." });
      } catch (error) {
        return res.status(502).json({ error: error.message });
      }
    }

    if (!ensureDemoAllowed(config, res, "Zoho Cliq")) return undefined;
    return res.json({
      ok: true,
      mode: "demo",
      delivered: true,
      message: "Demo mode: Zoho Cliq test accepted. Add ZOHO_CLIQ_WEBHOOK_URL to .env to send for real.",
    });
  });
}
