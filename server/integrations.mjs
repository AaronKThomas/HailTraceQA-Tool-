function trimSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function extractJiraText(field) {
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

export async function sendZohoCliqWebhook(config, payload) {
  const { description = "", status = "", verdict = "", message = "" } = payload;
  const text = message || [
    "HailTrace QA",
    description ? `Test: ${description}` : null,
    status ? `Status: ${status}` : null,
    verdict ? `Verdict: ${verdict}` : null,
  ].filter(Boolean).join("\n");

  const response = await fetch(config.zohoCliqWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Zoho Cliq webhook error ${response.status}`);
  }

  return { ok: true, mode: "live", delivered: true };
}
