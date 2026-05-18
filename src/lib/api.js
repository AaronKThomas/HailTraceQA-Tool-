export async function pingServer(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/health`);
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function loginRequest(backendUrl, username, password) {
  const response = await fetch(`${backendUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Incorrect username or password.");
  return data.account;
}

export async function registerRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Registration failed.");
  return data.account;
}

export async function fetchAllAccounts(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/accounts`);
    return response.ok ? response.json() : [];
  } catch {
    return [];
  }
}

export async function fetchRegisteredAccount(backendUrl, username) {
  const accounts = await fetchAllAccounts(backendUrl);
  return accounts.find((account) => account.username?.toLowerCase() === username.toLowerCase()) || null;
}

export async function removeAccount(backendUrl, username) {
  const response = await fetch(`${backendUrl}/accounts/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed.");
  }
}

export async function runTestRequest(backendUrl, description, jiraKey) {
  const response = await fetch(`${backendUrl}/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, jiraKey: jiraKey || null }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Server error");
  return data;
}

export async function fetchJiraTicket(config, key) {
  // The frontend never talks to Jira directly. Keeping this request behind the
  // backend preserves one trust boundary for future credentials and logging.
  const response = await fetch(`${config.backendUrl}/jira/issue/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Jira error ${response.status}`);
  return response.json();
}

export async function checkEndpoint(backendUrl, path, method = "GET") {
  const start = Date.now();
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: error.message,
      latency: Date.now() - start,
    };
  }
}

export async function sendSlackNotificationRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/notifications/slack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send Slack notification.");
  }
}

export async function testSlackWebhookRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/notifications/slack/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send test Slack notification.");
  }
}
