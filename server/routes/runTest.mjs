// /run-test pipeline selection.
//
// Order: OpenAI (alone or guiding HailTrace) -> HailTrace direct -> demo mock.
// Each failure path returns the same response envelope so the frontend has
// a single shape to render whether the failure came from OpenAI or HailTrace.

import { applyRateLimit, ensureDemoAllowed, requireAuth } from "../middleware.mjs";
import { hasOpenAiConfig, hasRealHailTraceConfig } from "../config.mjs";
import { runHailTraceTest } from "../integrations.mjs";
import { runOpenAiGuidedHailTraceTest, runOpenAiQaPlan } from "../openai.mjs";
import { resolveTestInput } from "../testInputResolver.mjs";
import { buildMockAnalysis } from "../mockAnalysis.mjs";

function buildFailureResponse({ text, message, apiResults, source }) {
  const lines = [
    "WHAT IS BEING TESTED",
    text,
    "",
    "API RESULTS",
    source === "openai"
      ? `ChatGPT or HailTrace pipeline failed: ${message}`
      : `HailTrace API request failed: ${message}`,
  ];
  if (source === "openai") {
    lines.push("", "RECOMMENDATIONS", "Fix OPENAI_API_KEY and HailTrace API credentials, then re-run the test.");
  }
  lines.push("", "VERDICT: FAIL");

  const response = {
    error: message,
    verdict: "FAIL",
    analysis: lines.join("\n"),
    apiResults: apiResults || [],
    playwrightLog: source === "openai" ? message : "",
  };
  if (source === "openai") {
    response.recommendations = [];
  }
  return response;
}

export function registerRunTestRoutes(app, { config, rateLimits }) {
  app.post("/run-test", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.runTest, "test execution")) return undefined;

    let text;
    let ticketKey;
    try {
      const { description, jiraKey } = req.body || {};
      if (!description) {
        return res.status(400).json({ error: "Description is required." });
      }
      const resolved = await resolveTestInput(config, description, jiraKey);
      text = resolved.text;
      ticketKey = resolved.ticketKey;
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid test request." });
    }

    if (hasOpenAiConfig(config)) {
      try {
        const result = hasRealHailTraceConfig(config)
          ? await runOpenAiGuidedHailTraceTest(config, text, ticketKey)
          : await runOpenAiQaPlan(config, text, ticketKey);
        return res.json(result);
      } catch (error) {
        return res.status(502).json(buildFailureResponse({
          text,
          message: error.message,
          apiResults: error.apiResults,
          source: "openai",
        }));
      }
    }

    if (hasRealHailTraceConfig(config)) {
      try {
        const result = await runHailTraceTest(config, text, ticketKey);
        return res.json(result);
      } catch (error) {
        return res.status(502).json(buildFailureResponse({
          text,
          message: error.message,
          apiResults: error.apiResults,
          source: "hailtrace",
        }));
      }
    }

    if (!ensureDemoAllowed(config, res, "HailTrace QA")) return undefined;
    return res.json(buildMockAnalysis(text, ticketKey));
  });
}
