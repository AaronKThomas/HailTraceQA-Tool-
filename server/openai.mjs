import { ACTION_PLAN_ACTIONS, WebsiteQaBusyError, normalizeVerdict, redactUrlForLog, runWebsiteQaTest } from "./websiteQa.mjs";
import { fetchWithTimeout } from "./http.mjs";
import { isCancellationError, throwIfAborted } from "./cancellation.mjs";

// LLM completions are far slower than the health probes that share the helper,
// so allow a generous ceiling while still guaranteeing the request handler is
// never held open by a hung provider.
const OPENAI_TIMEOUT_MS = 120000;

function formatRecommendationsBlock(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return "No follow-up items were identified.";
  }

  return recommendations
    .map((item, index) => {
      const title = String(item.title || `Item ${index + 1}`).trim();
      const description = String(item.description || "").trim();
      return `${index + 1}. ${title}\n   ${description}`;
    })
    .join("\n\n");
}

function formatCombinedAnalysis({
  whatIsBeingTested,
  apiResultsNote,
  codeAnalysis,
  errorLocation,
  recommendations,
  verdict,
}) {
  return [
    "WHAT IS BEING TESTED",
    whatIsBeingTested,
    "",
    "API RESULTS",
    apiResultsNote,
    "",
    "CODE ANALYSIS",
    codeAnalysis,
    "",
    "ERROR LOCATION",
    errorLocation,
    "",
    "RECOMMENDATIONS",
    formatRecommendationsBlock(recommendations),
    "",
    `VERDICT: ${verdict}`,
  ].join("\n");
}

async function callOpenAiJson(config, { name, schema, system, user, signal }) {
  throwIfAborted(signal);
  const started = Date.now();
  const endpoint = `${config.openaiBaseUrl}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  // Local OpenAI-compatible servers (e.g. Ollama) accept no key; only send the
  // Authorization header when one is configured.
  if (config.openaiApiKey) {
    headers.Authorization = `Bearer ${config.openaiApiKey}`;
  }
  const describe = () => (name === "website_qa_execution_plan"
    ? "ChatGPT — interpret request"
    : "ChatGPT — summarize results");

  let response;
  try {
    response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.openaiModel || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema },
        },
      }),
      signal,
    }, OPENAI_TIMEOUT_MS);
  } catch (cause) {
    if (signal?.aborted && isCancellationError(cause)) throw cause;
    // Surface a clean message (no low-level transport detail) and keep the
    // apiResults envelope the route expects so the failure renders uniformly.
    const message = cause?.name === "AbortError"
      ? `OpenAI request timed out after ${OPENAI_TIMEOUT_MS / 1000}s.`
      : "Could not reach the OpenAI API.";
    const error = new Error(message);
    error.apiResults = [{
      type: "REST",
      method: "POST",
      endpoint,
      description: describe(),
      result: { ok: false, status: 0 },
      error: message,
    }];
    throw error;
  }

  const latency = Date.now() - started;
  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = {};
  }

  const apiResult = {
    type: "REST",
    method: "POST",
    endpoint,
    description: describe(),
    result: { ok: response.ok, status: response.status },
    error: response.ok ? undefined : payload.error?.message || response.statusText,
  };

  if (!response.ok) {
    const error = new Error(payload.error?.message || `OpenAI API error ${response.status}`);
    error.apiResults = [apiResult];
    throw error;
  }

  const content = payload.choices?.[0]?.message?.content;
  let data;
  try {
    data = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    const error = new Error("OpenAI returned an invalid JSON payload.");
    error.apiResults = [apiResult];
    throw error;
  }

  return { data, apiResult, latency };
}

const EXECUTION_PLAN_SCHEMA = {
  type: "object",
  properties: {
    whatIsBeingTested: { type: "string" },
    executionDescription: {
      type: "string",
      description: "Precise website QA brief used by the local Playwright runner",
    },
    testFocus: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
    actionPlan: {
      type: ["object", "null"],
      properties: {
        targetUrl: { type: "string" },
        requiresAuth: { type: "boolean" },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ACTION_PLAN_ACTIONS,
              },
              url: { type: ["string", "null"] },
              index: { type: ["number", "null"] },
              text: { type: ["string", "null"] },
              role: { type: ["string", "null"] },
              name: { type: ["string", "null"] },
              selector: { type: ["string", "null"] },
              label: { type: ["string", "null"] },
              value: { type: ["string", "null"] },
              direction: { type: ["string", "null"], enum: ["up", "down", "left", "right", null] },
              distance: { type: ["number", "null"] },
              timeoutMs: { type: ["number", "null"] },
              position: {
                type: ["object", "null"],
                properties: {
                  xRatio: { type: "number" },
                  yRatio: { type: "number" },
                },
                required: ["xRatio", "yRatio"],
                additionalProperties: false,
              },
            },
            required: [
              "action",
              "url",
              "index",
              "text",
              "role",
              "name",
              "selector",
              "label",
              "value",
              "direction",
              "distance",
              "timeoutMs",
              "position",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["targetUrl", "requiresAuth", "steps"],
      additionalProperties: false,
    },
  },
  required: ["whatIsBeingTested", "executionDescription", "testFocus", "actionPlan"],
  additionalProperties: false,
};

const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    codeAnalysis: { type: "string" },
    errorLocation: { type: "string" },
    apiResultsNote: { type: "string" },
    executionSummary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
        additionalProperties: false,
      },
      minItems: 1,
    },
  },
  required: [
    "codeAnalysis",
    "errorLocation",
    "apiResultsNote",
    "executionSummary",
    "recommendations",
  ],
  additionalProperties: false,
};

const PLAN_SYSTEM = `You translate plain-English QA requests or Jira tickets into a precise execution brief for a local Playwright website QA runner.

Rules:
- When a Jira key is provided, treat summary, description, and acceptance criteria as the source of truth.
- executionDescription must be self-contained: target URL if present, feature under test, expected outcomes, and edge cases from the ticket or user text.
- Preserve any http:// or https:// URL from the user content exactly so Playwright can navigate to it.
- Never invent a non-HailTrace URL. If the source text does not contain a public http:// or https:// URL, use the configured HailTrace default target URL from the user message.
- When actionPlan is not null, targetUrl and every navigate step must stay on the same origin as either the explicit URL in the source text or the configured HailTrace default target URL.
- Map each acceptance criterion to at least one browser-observable check when criteria are present.
- Produce actionPlan using only these allowed actions: ${ACTION_PLAN_ACTIONS.join(", ")}.
- Never use clickSelector or expectVisible without a non-empty selector. If no stable selector is known, omit that selector-based step and rely on navigation/page audit or use expectText for specific visible text.
- For HailTrace map/weather-event search requests, use fillSearch with value "hail" unless the user supplied a specific search query, then selectCheckbox index 0 to choose the first storm/date result, then panMap to actively look for swaths or polygons on the map.
- Use clickSelector only for simple selectors: tag, id, class, data-testid, or aria-label. For map/canvas clicks, prefer selector ".mapboxgl-canvas, .leaflet-container, canvas" with position { "xRatio": 0.5, "yRatio": 0.5 }.
- If the user asks to pan, drag, or move the map, use panMap with selector ".mapboxgl-canvas, .leaflet-container, canvas", direction "right", and distance 220. This step performs a real drag and verifies the map image changes.
- To select an item from a list of checkboxes (e.g. a weather-event list), use selectCheckbox with a 0-based "index" (0 = first). It clicks the styled control even when the underlying input is hidden, and verifies the box becomes checked.
- In the HailTrace maps weather-event flow, "download" means selecting the checkbox on a storm date card. Do not wait for or click visible text/button "Download"; use selectCheckbox after the storm date cards are available.
- Use requiresAuth=true for app.hailtrace.com and other pages likely to require login.
- Do not claim tests were run; you are only preparing what the deterministic Playwright runner should inspect.`;

const SYNTHESIS_SYSTEM = `You summarize local Playwright website QA execution results for internal testers.

Rules:
- When jiraKey is present, reference the ticket in executionSummary and tie failures back to acceptance criteria where possible.
- The Playwright verdict is authoritative; explain it clearly in codeAnalysis and executionSummary.
- If the verdict is PASS, do not describe advisory console, accessibility, network, or link-probe concerns as a failed test. State that the requested browser objective passed, then explain concerns separately as follow-up observations.
- errorLocation: file paths, components, API routes, or UI areas that need work when the run failed or needs manual check; otherwise state "No defects located" or similar.
- recommendations: concrete fix or verification steps. Each needs title + description. On PASS, recommend regression or monitoring steps.
- executionSummary: 3–8 sentence narrative for the execution log (what ran, outcome, key failures, Jira key if any).
- apiResultsNote: plain-English summary of what the Playwright runner reported (status, errors, notable checks).`;

function formatWhatIsBeingTested(plan, description, jiraKey) {
  const base = plan.whatIsBeingTested || description;
  return jiraKey ? `[${jiraKey}] ${base}` : base;
}

function sanitizeForSummary(value) {
  if (typeof value === "string") {
    return value.replace(/https?:\/\/[^\s<>"')]+/gi, (url) => redactUrlForLog(url));
  }
  if (Array.isArray(value)) return value.map(sanitizeForSummary);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeForSummary(item)]),
    );
  }
  return value;
}

async function planWebsiteQaExecution(config, description, jiraKey, { signal } = {}) {
  const user = [
    jiraKey ? `Jira ticket: ${jiraKey}` : null,
    config.targetSiteDefaultUrl ? `Configured HailTrace default target URL: ${redactUrlForLog(config.targetSiteDefaultUrl)}` : null,
    "Ticket / user content:",
    description,
  ].filter(Boolean).join("\n\n");

  const { data, apiResult, latency } = await callOpenAiJson(config, {
    name: "website_qa_execution_plan",
    schema: EXECUTION_PLAN_SCHEMA,
    system: PLAN_SYSTEM,
    user,
    signal,
  });

  return {
    plan: data,
    apiResult,
    latency,
  };
}

async function synthesizeExecutionReport(config, description, jiraKey, plan, playwrightResult, { signal } = {}) {
  const user = JSON.stringify({
    jiraKey,
    originalRequest: sanitizeForSummary(description),
    chatGptPlan: sanitizeForSummary(plan),
    playwrightVerdict: playwrightResult.verdict,
    playwrightAnalysis: sanitizeForSummary(playwrightResult.analysis),
    playwrightApiResults: sanitizeForSummary(playwrightResult.apiResults),
    playwrightLog: sanitizeForSummary(playwrightResult.playwrightLog),
  }, null, 2);

  const { data, apiResult, latency } = await callOpenAiJson(config, {
    name: "website_qa_execution_summary",
    schema: SYNTHESIS_SCHEMA,
    system: SYNTHESIS_SYSTEM,
    user,
    signal,
  });

  return { synthesis: data, apiResult, latency };
}

function normalizeRecommendations(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      title: String(item.title || "").trim(),
      description: String(item.description || "").trim(),
    }))
    .filter((item) => item.title && item.description);
}

export function classifyWebsiteQaExecutionError(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (
    lower.includes("browsertype.launch")
    || lower.includes("executable doesn't exist")
    || lower.includes("please run")
    || lower.includes("bootstrap_check_in")
    || lower.includes("machportrendezvous")
    || lower.includes("permission denied")
    || lower.includes("kill eperm")
  ) {
    return {
      errorLocation: "Local Playwright runtime",
      recommendation: "Run the backend from a normal terminal or deployment process with permission to launch Chromium, and confirm Playwright browsers are installed with `npx playwright install chromium`.",
    };
  }

  if (
    lower.includes("target-site authentication is required")
    || lower.includes("target-site login")
    || lower.includes("target-site login url must use the same origin")
    || lower.includes("could not locate the email field")
    || lower.includes("could not locate the password field")
    || lower.includes("could not locate the login submit button")
  ) {
    return {
      errorLocation: "Target-site authentication",
      recommendation: "Configure TARGET_SITE_LOGIN_URL, TARGET_SITE_TEST_EMAIL, TARGET_SITE_TEST_PASSWORD, and selectors as needed, or test a public unauthenticated URL.",
    };
  }

  if (
    lower.includes("private, local, or reserved")
    || lower.includes("local hostnames cannot be tested")
    || lower.includes("only http:// and https://")
    || lower.includes("website hostname could not be resolved")
    || lower.includes("may not navigate away")
  ) {
    return {
      errorLocation: "Website URL safety validation",
      recommendation: "Use a public http:// or https:// URL whose DNS resolves to public IP addresses, and keep action-plan navigation on the original origin.",
    };
  }

  if (
    lower.includes("timeout")
    || lower.includes("net::")
    || lower.includes("enotfound")
    || lower.includes("econnrefused")
    || lower.includes("etimedout")
    || lower.includes("fetch failed")
  ) {
    return {
      errorLocation: "Target website network",
      recommendation: "Confirm the target site is reachable from the machine running the backend, then retry with a smaller page or a more specific public URL.",
    };
  }

  if (lower.includes("step ") || lower.includes("selector")) {
    return {
      errorLocation: "Target page action plan",
      recommendation: "Review the generated action plan and use stable text, role, data-testid, aria-label, or simple selector targets.",
    };
  }

  return {
    errorLocation: "Website QA execution",
    recommendation: "Review the Playwright raw log for the exact runtime, network, or page-action failure before retrying.",
  };
}

/** OpenAI interprets input → local Playwright executes → OpenAI summarizes for the UI log. */
export async function runOpenAiGuidedWebsiteQaTest(config, description, jiraKey, {
  ownerEmail = "",
  signal,
} = {}) {
  const { plan, apiResult: planApiResult, latency: planLatency } = await planWebsiteQaExecution(
    config,
    description,
    jiraKey,
    { signal },
  );
  throwIfAborted(signal);

  const executionDescription = String(plan.executionDescription || description).trim();
  const repairDescription = [
    description,
    executionDescription && executionDescription !== description
      ? `\n\nExecution brief:\n${executionDescription}`
      : "",
  ].join("").trim();
  const actionPlan = plan.actionPlan || null;
  let playwrightResult;
  try {
    playwrightResult = await runWebsiteQaTest(config, repairDescription, jiraKey, actionPlan, {
      ownerEmail,
      repairGeneratedPlan: true,
      signal,
    });
  } catch (error) {
    // Capacity backpressure is not a QA failure: let it propagate so the route
    // returns a retryable 503 instead of a misleading FAIL verdict.
    if (error instanceof WebsiteQaBusyError) throw error;
    const failVerdict = "FAIL";
    const failure = classifyWebsiteQaExecutionError(error);
    const recommendations = normalizeRecommendations([
      {
        title: "Retry after fixing Playwright execution",
        description: `Execution failed: ${error.message}. ${failure.recommendation}`,
      },
    ]);

    return {
      verdict: failVerdict,
      analysis: formatCombinedAnalysis({
        whatIsBeingTested: formatWhatIsBeingTested(plan, description, jiraKey),
        apiResultsNote: `Playwright execution failed before completion.\n\nChatGPT execution brief:\n${executionDescription}\n\nError: ${error.message}`,
        codeAnalysis: "Automated QA did not complete. Review the execution brief, target URL, and Playwright runtime.",
        errorLocation: failure.errorLocation,
        recommendations,
        verdict: failVerdict,
      }),
      recommendations,
      apiResults: [planApiResult, ...(error.apiResults || [])],
      playwrightLog: [
        `[openai] Interpreted request in ${planLatency}ms`,
        `[playwright] Execution failed: ${error.message}`,
        "",
        "Execution brief sent to Playwright:",
        sanitizeForSummary(executionDescription),
        ...(actionPlan
          ? [
            "",
            "Action plan sent to Playwright:",
            JSON.stringify(sanitizeForSummary(actionPlan), null, 2),
          ]
          : []),
      ].join("\n"),
    };
  }

  const { synthesis, apiResult: synthesisApiResult, latency: synthesisLatency } = await synthesizeExecutionReport(
    config,
    description,
    jiraKey,
    plan,
    playwrightResult,
    { signal },
  );

  const verdict = normalizeVerdict(playwrightResult.verdict);
  const recommendations = normalizeRecommendations(synthesis.recommendations);

  const playwrightLog = playwrightResult.playwrightLog
    ? `\n\n--- Playwright raw log ---\n${playwrightResult.playwrightLog}`
    : "";

  return {
    verdict,
    analysis: formatCombinedAnalysis({
      whatIsBeingTested: formatWhatIsBeingTested(plan, description, jiraKey),
      apiResultsNote: synthesis.apiResultsNote,
      codeAnalysis: synthesis.codeAnalysis,
      errorLocation: synthesis.errorLocation,
      recommendations,
      verdict,
    }),
    recommendations,
    apiResults: [planApiResult, ...playwrightResult.apiResults, synthesisApiResult],
    replay: playwrightResult.replay || null,
    playwrightLog: [
      synthesis.executionSummary,
      "",
      `[openai] Planned in ${planLatency}ms · summarized in ${synthesisLatency}ms`,
      `[playwright] Verdict: ${verdict}`,
      playwrightLog,
    ].join("\n").trim(),
  };
}
