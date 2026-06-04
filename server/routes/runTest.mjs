// /run-test pipeline selection.
//
// Order: OpenAI-guided Playwright -> direct Playwright -> demo mock.
// Each failure path returns the same response envelope so the frontend has
// a single shape to render whether the failure came from OpenAI or Playwright.

import { applyRateLimit, ensureDemoAllowed, requireAuth } from "../middleware.mjs";
import { hasOpenAiConfig } from "../config.mjs";
import { runOpenAiGuidedWebsiteQaTest } from "../openai.mjs";
import { resolveTestInput } from "../testInputResolver.mjs";
import { buildMockAnalysis } from "../mockAnalysis.mjs";
import { WebsiteQaBusyError, extractFirstHttpUrl, runWebsiteQaTest } from "../websiteQa.mjs";
import { createRequestAbortSignal, isCancellationError } from "../cancellation.mjs";

function buildFailureResponse({ text, message, apiResults }) {
  const lines = [
    "WHAT IS BEING TESTED",
    text,
    "",
    "API RESULTS",
    `ChatGPT or Playwright pipeline failed: ${message}`,
  ];
  lines.push("", "RECOMMENDATIONS", "Fix OPENAI_API_KEY, Playwright browser dependencies, or the target website URL, then re-run the test.");
  lines.push("", "VERDICT: FAIL");

  return {
    error: message,
    verdict: "FAIL",
    analysis: lines.join("\n"),
    apiResults: apiResults || [],
    recommendations: [],
    playwrightLog: message,
  };
}

// A pipeline error is either capacity backpressure (retryable, no FAIL verdict)
// or a genuine execution failure. Both are funneled through here so every
// branch of the route responds with the same shape.
function respondWithPipelineError(res, text, error) {
  if (isCancellationError(error)) {
    if (res.headersSent) return undefined;
    return res.status(499).json({ error: "Test run cancelled.", cancelled: true });
  }
  if (error instanceof WebsiteQaBusyError) {
    return res.status(503).json({ error: error.message, retryable: true });
  }
  return res.status(502).json(buildFailureResponse({
    text,
    message: error.message,
    apiResults: error.apiResults,
  }));
}

export function registerRunTestRoutes(app, { config, rateLimits }) {
  app.post("/run-test", requireAuth, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.runTest, "test execution")) return undefined;
    const signal = createRequestAbortSignal(req, res);

    let text;
    let ticketKey;
    let actionPlan;
    try {
      const { description, jiraKey } = req.body || {};
      actionPlan = req.body?.actionPlan || null;
      if (!description) {
        return res.status(400).json({ error: "Description is required." });
      }
      if (signal.aborted) return undefined;
      const resolved = await resolveTestInput(config, description, jiraKey);
      if (signal.aborted) return undefined;
      text = resolved.text;
      ticketKey = resolved.ticketKey;
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invalid test request." });
    }

    if (actionPlan && !config.allowClientActionPlans) {
      return res.status(403).json({
        error: "Client-supplied action plans are disabled. Set ALLOW_CLIENT_ACTION_PLANS=true to enable them.",
      });
    }

    if (actionPlan?.targetUrl) {
      try {
        const result = await runWebsiteQaTest(config, text, ticketKey, actionPlan, {
          ownerEmail: req.user.email,
          signal,
        });
        if (signal.aborted) return undefined;
        return res.json(result);
      } catch (error) {
        return respondWithPipelineError(res, text, error);
      }
    }

    if (hasOpenAiConfig(config)) {
      try {
        const result = await runOpenAiGuidedWebsiteQaTest(config, text, ticketKey, {
          ownerEmail: req.user.email,
          signal,
        });
        if (signal.aborted) return undefined;
        return res.json(result);
      } catch (error) {
        return respondWithPipelineError(res, text, error);
      }
    }

    if (extractFirstHttpUrl(text)) {
      try {
        const result = await runWebsiteQaTest(config, text, ticketKey, actionPlan, {
          ownerEmail: req.user.email,
          signal,
        });
        if (signal.aborted) return undefined;
        return res.json(result);
      } catch (error) {
        return respondWithPipelineError(res, text, error);
      }
    }

    if (!ensureDemoAllowed(config, res, "Website QA")) return undefined;
    return res.json(buildMockAnalysis(text, ticketKey));
  });
}
