async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function apiRequest(backendUrl, path, {
  method = "GET",
  body,
  headers = {},
  errorMessage = "Request failed.",
  signal,
} = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    method,
    headers: body === undefined
      ? headers
      : { "Content-Type": "application/json", ...headers },
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await readJson(response);
  if (!response.ok) {
    const fallback = typeof errorMessage === "function"
      ? errorMessage(response, data)
      : errorMessage;
    throw new Error(data?.error || fallback);
  }
  return data;
}

export async function pingServer(backendUrl) {
  try {
    await apiRequest(backendUrl, "/health");
    return "ok";
  } catch {
    return "error";
  }
}

export async function fetchHealth(backendUrl) {
  try {
    return await apiRequest(backendUrl, "/health");
  } catch {
    return null;
  }
}

export async function fetchIntegrationsHealth(backendUrl) {
  try {
    return await apiRequest(backendUrl, "/health/integrations");
  } catch {
    return null;
  }
}

export async function loginRequest(backendUrl, email, password) {
  const data = await apiRequest(backendUrl, "/login", {
    method: "POST",
    body: { email, password },
    errorMessage: "Incorrect email or password.",
  });
  return data.account;
}

export async function registerRequest(backendUrl, payload) {
  const data = await apiRequest(backendUrl, "/register", {
    method: "POST",
    body: payload,
    errorMessage: "Registration failed.",
  });
  return data.account;
}

export async function logoutRequest(backendUrl) {
  await apiRequest(backendUrl, "/logout", {
    method: "POST",
    errorMessage: "Logout failed.",
  });
}

export async function fetchSession(backendUrl) {
  try {
    const data = await apiRequest(backendUrl, "/session");
    return data.authenticated ? data.account : null;
  } catch {
    return null;
  }
}

export async function fetchAllAccounts(backendUrl) {
  try {
    return await apiRequest(backendUrl, "/accounts");
  } catch {
    return [];
  }
}

export async function removeAccount(backendUrl, email) {
  await apiRequest(backendUrl, `/accounts/${encodeURIComponent(email)}`, {
    method: "DELETE",
    errorMessage: "Failed.",
  });
}

export async function inviteUserRequest(backendUrl, { email, displayName }) {
  const data = await apiRequest(backendUrl, "/invite", {
    method: "POST",
    body: { email, displayName },
    errorMessage: "Could not send invite.",
  });
  return data.account;
}

export async function validateInviteToken(backendUrl, token) {
  try {
    return await apiRequest(backendUrl, `/invite/${encodeURIComponent(token)}`);
  } catch {
    return { valid: false };
  }
}

export async function acceptInviteRequest(backendUrl, { token, password, displayName }) {
  const data = await apiRequest(backendUrl, "/accept-invite", {
    method: "POST",
    body: { token, password, displayName },
    errorMessage: "Could not accept invite.",
  });
  return data.account;
}

export async function forgotPasswordRequest(backendUrl, email) {
  // The server always returns 200 regardless of whether the email exists.
  // We mirror that here so the UI never reveals account existence.
  await fetch(`${backendUrl}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });
}

export async function validateResetToken(backendUrl, token) {
  try {
    return await apiRequest(backendUrl, `/reset/${encodeURIComponent(token)}`);
  } catch {
    return { valid: false };
  }
}

export async function resetPasswordRequest(backendUrl, { token, password }) {
  await apiRequest(backendUrl, "/reset-password", {
    method: "POST",
    body: { token, password },
    errorMessage: "Could not reset password.",
  });
}

export async function runTestRequest(backendUrl, description, jiraKey, { signal } = {}) {
  return await apiRequest(backendUrl, "/run-test", {
    method: "POST",
    body: { description, jiraKey: jiraKey || null },
    errorMessage: "Server error",
    signal,
  });
}

export async function fetchJiraTicket(config, key) {
  // The frontend never talks to Jira directly. Keeping this request behind the
  // backend preserves one trust boundary for future credentials and logging.
  return await apiRequest(config.backendUrl, `/jira/issue/${encodeURIComponent(key)}`, {
    headers: { Accept: "application/json" },
    errorMessage: (response) => `Jira error ${response.status}`,
  });
}

export async function checkEndpoint(backendUrl, path, method = "GET") {
  const start = Date.now();
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
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
  await apiRequest(backendUrl, "/notifications/slack", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to send Slack notification.",
  });
}

export async function testSlackWebhookRequest(backendUrl, payload) {
  await apiRequest(backendUrl, "/notifications/slack/test", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to send test Slack notification.",
  });
}

export async function sendZohoCliqNotificationRequest(backendUrl, payload) {
  await apiRequest(backendUrl, "/notifications/zoho-cliq", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to send Zoho Cliq notification.",
  });
}

export async function testZohoCliqWebhookRequest(backendUrl, payload) {
  await apiRequest(backendUrl, "/notifications/zoho-cliq/test", {
    method: "POST",
    body: payload,
    errorMessage: "Failed to send test Zoho Cliq notification.",
  });
}
