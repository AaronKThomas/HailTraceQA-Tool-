import { runHailTraceTest } from "./integrations.mjs";

function normalizeVerdict(value) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("PASS")) return "PASS";
  if (raw.includes("MANUAL")) return "NEEDS MANUAL CHECK";
  if (raw.includes("FAIL")) return "FAIL";
  return "NEEDS MANUAL CHECK";
}

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

export function formatCombinedAnalysis({
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

async function callOpenAiJson(config, { name, schema, system, user }) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
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
  });

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
    endpoint: "https://api.openai.com/v1/chat/completions",
    description: name === "hailtrace_execution_plan" ? "ChatGPT — interpret request" : "ChatGPT — summarize results",
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
      description: "Precise test brief sent to the HailTrace QA execution API",
    },
    testFocus: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
  },
  required: ["whatIsBeingTested", "executionDescription", "testFocus"],
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

const PLAN_SYSTEM = `You translate plain-English QA requests or Jira tickets into a precise execution brief for the HailTrace automated QA API.

Rules:
- When a Jira key is provided, treat summary, description, and acceptance criteria as the source of truth.
- executionDescription must be self-contained: feature under test, steps, expected outcomes, and edge cases from the ticket or user text.
- Map each acceptance criterion to at least one check HailTrace should run when criteria are present.
- Do not claim tests were run; you are only preparing what HailTrace should execute.
- Be specific to HailTrace product context when the request mentions maps, hail, reports, accounts, etc.`;

const SYNTHESIS_SYSTEM = `You summarize HailTrace automated QA execution results for internal testers.

Rules:
- When jiraKey is present, reference the ticket in executionSummary and tie failures back to acceptance criteria where possible.
- The HailTrace verdict is authoritative; explain it clearly in codeAnalysis and executionSummary.
- errorLocation: file paths, components, API routes, or UI areas that need work when the run failed or needs manual check; otherwise state "No defects located" or similar.
- recommendations: concrete fix or verification steps. Each needs title + description. On PASS, recommend regression or monitoring steps.
- executionSummary: 3–8 sentence narrative for the execution log (what ran, outcome, key failures, Jira key if any).
- apiResultsNote: plain-English summary of what the HailTrace API reported (status, errors, notable checks).`;

function formatWhatIsBeingTested(plan, description, jiraKey) {
  const base = plan.whatIsBeingTested || description;
  return jiraKey ? `[${jiraKey}] ${base}` : base;
}

async function planHailTraceExecution(config, description, jiraKey) {
  const user = [
    jiraKey ? `Jira ticket: ${jiraKey}` : null,
    "Ticket / user content:",
    description,
  ].filter(Boolean).join("\n\n");

  const { data, apiResult, latency } = await callOpenAiJson(config, {
    name: "hailtrace_execution_plan",
    schema: EXECUTION_PLAN_SCHEMA,
    system: PLAN_SYSTEM,
    user,
  });

  return {
    plan: data,
    apiResult,
    latency,
  };
}

async function synthesizeExecutionReport(config, description, jiraKey, plan, hailtraceResult) {
  const user = JSON.stringify({
    jiraKey,
    originalRequest: description,
    chatGptPlan: plan,
    hailtraceVerdict: hailtraceResult.verdict,
    hailtraceAnalysis: hailtraceResult.analysis,
    hailtraceApiResults: hailtraceResult.apiResults,
    hailtracePlaywrightLog: hailtraceResult.playwrightLog,
  }, null, 2);

  const { data, apiResult, latency } = await callOpenAiJson(config, {
    name: "hailtrace_execution_summary",
    schema: SYNTHESIS_SCHEMA,
    system: SYNTHESIS_SYSTEM,
    user,
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

/** OpenAI interprets input → HailTrace executes → OpenAI summarizes for the UI log. */
export async function runOpenAiGuidedHailTraceTest(config, description, jiraKey) {
  const { plan, apiResult: planApiResult, latency: planLatency } = await planHailTraceExecution(
    config,
    description,
    jiraKey,
  );

  const executionDescription = String(plan.executionDescription || description).trim();
  let hailtraceResult;
  try {
    hailtraceResult = await runHailTraceTest(config, executionDescription, jiraKey);
  } catch (error) {
    const failVerdict = "FAIL";
    const recommendations = normalizeRecommendations([
      {
        title: "Retry after fixing HailTrace API",
        description: `Execution failed: ${error.message}. Confirm HAILTRACE_API_BASE_URL, HAILTRACE_API_KEY, and that the service is reachable.`,
      },
    ]);

    return {
      verdict: failVerdict,
      analysis: formatCombinedAnalysis({
        whatIsBeingTested: formatWhatIsBeingTested(plan, description, jiraKey),
        apiResultsNote: `HailTrace execution failed before completion.\n\nChatGPT execution brief:\n${executionDescription}\n\nError: ${error.message}`,
        codeAnalysis: "Automated QA did not complete. Review the execution brief and API configuration.",
        errorLocation: "HailTrace API / network layer",
        recommendations,
        verdict: failVerdict,
      }),
      recommendations,
      apiResults: [planApiResult, ...(error.apiResults || [])],
      playwrightLog: [
        `[openai] Interpreted request in ${planLatency}ms`,
        `[hailtrace] Execution failed: ${error.message}`,
        "",
        "Execution brief sent to HailTrace:",
        executionDescription,
      ].join("\n"),
    };
  }

  const { synthesis, apiResult: synthesisApiResult, latency: synthesisLatency } = await synthesizeExecutionReport(
    config,
    description,
    jiraKey,
    plan,
    hailtraceResult,
  );

  const verdict = normalizeVerdict(hailtraceResult.verdict);
  const recommendations = normalizeRecommendations(synthesis.recommendations);

  const hailtraceLog = hailtraceResult.playwrightLog
    ? `\n\n--- HailTrace raw log ---\n${hailtraceResult.playwrightLog}`
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
    apiResults: [planApiResult, ...hailtraceResult.apiResults, synthesisApiResult],
    playwrightLog: [
      synthesis.executionSummary,
      "",
      `[openai] Planned in ${planLatency}ms · summarized in ${synthesisLatency}ms`,
      `[hailtrace] Verdict: ${verdict}`,
      hailtraceLog,
    ].join("\n").trim(),
  };
}

/** Planning only when HailTrace credentials are not configured. */
export async function runOpenAiQaPlan(config, description, jiraKey) {
  const { plan, apiResult, latency } = await planHailTraceExecution(config, description, jiraKey);
  const recommendations = normalizeRecommendations(
    (plan.testFocus || []).map((focus) => ({
      title: String(focus),
      description: "Identified during planning. Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env to execute automatically.",
    })),
  );

  const verdict = "NEEDS MANUAL CHECK";

  return {
    verdict,
    analysis: formatCombinedAnalysis({
      whatIsBeingTested: formatWhatIsBeingTested(plan, description, jiraKey),
      apiResultsNote: "HailTrace API is not configured. ChatGPT prepared an execution brief only — no automated run was performed.",
      codeAnalysis: plan.executionDescription,
      errorLocation: jiraKey ? `Related Jira ticket: ${jiraKey}` : "Execution pending — configure HailTrace API credentials.",
      recommendations: recommendations.length ? recommendations : [{
        title: "Configure HailTrace API",
        description: "Add HAILTRACE_API_BASE_URL and HAILTRACE_API_KEY to .env, restart the backend, and re-run this test.",
      }],
      verdict,
    }),
    recommendations,
    apiResults: [apiResult],
    playwrightLog: [
      `[openai] Execution plan ready in ${latency}ms (HailTrace API not configured)`,
      "",
      "Brief that would be sent to HailTrace:",
      plan.executionDescription,
    ].join("\n"),
  };
}
