function trimSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function normalizeVerdict(value) {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("PASS")) return "PASS";
  if (raw.includes("MANUAL")) return "NEEDS MANUAL CHECK";
  if (raw.includes("FAIL")) return "FAIL";
  return "FAIL";
}

export function extractJiraText(field) {
  if (!field) return "";
  if (typeof field === "string") return field;

  function walk(node) {
    if (!node) return "";
    if (node.type === "text") return node.text || "";
    if (Array.isArray(node.content)) return node.content.map(walk).join("");
    return "";
  }

  if (field.type === "doc" && Array.isArray(field.content)) {
    return field.content.map(walk).join("\n").trim();
  }

  return "";
}

function parseAcceptanceCriteria(description) {
  if (!description) return "";
  const match = description.match(/acceptance criteria[:\s]*([\s\S]*)/i);
  return match ? match[1].trim() : "";
}

export function normalizeQaResponse(data, description, jiraKey) {
  const verdict = normalizeVerdict(
    data?.verdict
    || data?.result?.verdict
    || data?.status
    || data?.outcome,
  );

  const analysis = data?.analysis
    || data?.report
    || data?.output
    || data?.message
    || [
      "WHAT IS BEING TESTED",
      description,
      "",
      "API RESULTS",
      JSON.stringify(data?.apiResults || data?.results || [], null, 2),
      "",
      "VERDICT: " + verdict,
    ].join("\n");

  return {
    verdict,
    analysis: String(analysis),
    apiResults: Array.isArray(data?.apiResults)
      ? data.apiResults
      : Array.isArray(data?.results)
        ? data.results
        : [],
    playwrightLog: data?.playwrightLog || data?.playwright_log || "",
  };
}

export async function runHailTraceTest(config, description, jiraKey) {
  const baseUrl = trimSlash(config.hailtraceApiBaseUrl);
  const path = config.hailtraceQaPath || "/qa/run-test";
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.hailtraceAuthStyle === "api-key") {
    headers["X-API-Key"] = config.hailtraceApiKey;
  } else {
    headers.Authorization = `Bearer ${config.hailtraceApiKey}`;
  }

  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      description,
      jiraKey: jiraKey || null,
      prompt: description,
    }),
  });

  const latency = Date.now() - started;
  const rawText = await response.text();
  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { message: rawText };
  }

  const apiResult = {
    type: "REST",
    method: "POST",
    endpoint: url,
    description: "HailTrace QA evaluation",
    result: { ok: response.ok, status: response.status },
    error: response.ok ? undefined : payload.error || payload.message || response.statusText,
  };

  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `HailTrace API error ${response.status}`);
    error.apiResults = [apiResult];
    throw error;
  }

  const normalized = normalizeQaResponse(payload, description, jiraKey);
  normalized.apiResults = [apiResult, ...normalized.apiResults];
  if (!normalized.playwrightLog) {
    normalized.playwrightLog = `[hailtrace] Completed in ${latency}ms`;
  }
  return normalized;
}

export async function fetchJiraIssue(config, key) {
  const baseUrl = trimSlash(config.jiraBaseUrl);
  const auth = Buffer.from(`${config.jiraEmail}:${config.jiraApiToken}`).toString("base64");
  const fields = "summary,description";
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorMessages?.join(", ") || data.message || `Jira error ${response.status}`);
  }

  const description = extractJiraText(data.fields?.description);
  return {
    key: data.key || key,
    summary: data.fields?.summary || "",
    description,
    acceptanceCriteria: parseAcceptanceCriteria(description),
  };
}

export async function sendSlackWebhook(config, payload) {
  const { description = "", status = "", verdict = "", message = "" } = payload;
  const text = message || [
    "*HailTrace QA*",
    description ? `*Test:* ${description}` : null,
    status ? `*Status:* ${status}` : null,
    verdict ? `*Verdict:* ${verdict}` : null,
  ].filter(Boolean).join("\n");

  const response = await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Slack webhook error ${response.status}`);
  }

  return { ok: true, mode: "live", delivered: true };
}
