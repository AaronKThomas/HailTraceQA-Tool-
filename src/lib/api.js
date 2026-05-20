export async function pingServer(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/health`, {
      credentials: "include",
    });
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function fetchHealth(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/health`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchIntegrationsHealth(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/health/integrations`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function loginRequest(backendUrl, email, password) {
  const response = await fetch(`${backendUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Incorrect email or password.");
  return data.account;
}

export async function registerRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Registration failed.");
  return data.account;
}

export async function logoutRequest(backendUrl) {
  const response = await fetch(`${backendUrl}/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Logout failed.");
  }
}

export async function fetchSession(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/session`, {
      credentials: "include",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.authenticated ? data.account : null;
  } catch {
    return null;
  }
}

export async function fetchAllAccounts(backendUrl) {
  try {
    const response = await fetch(`${backendUrl}/accounts`, {
      credentials: "include",
    });
    return response.ok ? response.json() : [];
  } catch {
    return [];
  }
}

export async function fetchRegisteredAccount(backendUrl, email) {
  const accounts = await fetchAllAccounts(backendUrl);
  const needle = String(email || "").toLowerCase();
  return accounts.find((account) => account.email?.toLowerCase() === needle) || null;
}

export async function removeAccount(backendUrl, email) {
  const response = await fetch(`${backendUrl}/accounts/${encodeURIComponent(email)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed.");
  }
}

export async function inviteUserRequest(backendUrl, { email, displayName }) {
  const response = await fetch(`${backendUrl}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, displayName }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not send invite.");
  return data.account;
}

export async function validateInviteToken(backendUrl, token) {
  try {
    const response = await fetch(`${backendUrl}/invite/${encodeURIComponent(token)}`, {
      credentials: "include",
    });
    if (!response.ok) return { valid: false };
    return await response.json();
  } catch {
    return { valid: false };
  }
}

export async function acceptInviteRequest(backendUrl, { token, password, displayName }) {
  const response = await fetch(`${backendUrl}/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, password, displayName }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not accept invite.");
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
    const response = await fetch(`${backendUrl}/reset/${encodeURIComponent(token)}`, {
      credentials: "include",
    });
    if (!response.ok) return { valid: false };
    return await response.json();
  } catch {
    return { valid: false };
  }
}

export async function resetPasswordRequest(backendUrl, { token, password }) {
  const response = await fetch(`${backendUrl}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, password }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not reset password.");
  }
}

export async function runTestRequest(backendUrl, description, jiraKey) {
  const response = await fetch(`${backendUrl}/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
    credentials: "include",
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
  const response = await fetch(`${backendUrl}/notifications/slack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send test Slack notification.");
  }
}

export async function sendZohoCliqNotificationRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/notifications/zoho-cliq`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send Zoho Cliq notification.");
  }
}

export async function testZohoCliqWebhookRequest(backendUrl, payload) {
  const response = await fetch(`${backendUrl}/notifications/zoho-cliq/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to send test Zoho Cliq notification.");
  }
}
