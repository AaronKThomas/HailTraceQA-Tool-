// Customer.io transactional email client for invite + password-reset flows.
//
// Design:
// - Only the App API key (server-side) is used. Never expose in the browser.
// - Transactional sends only (not broadcast), so they ignore marketing
//   unsubscribe preferences — appropriate for security-critical mail.
// - Fails closed: a non-2xx from CIO or a timeout raises an error so the
//   caller can refuse to create an orphan account.
// - The API key is never included in thrown error messages or console logs.
// - Demo mode: when ALLOW_DEMO_MODE=true and no API key is configured, the
//   message is logged to the server console (recipient + redacted link).
//   This lets local dev exercise the full flow without burning CIO sends.
//
// CIO API contract (US region):
//   POST https://api.customer.io/v1/send/email
//   Authorization: Bearer <CUSTOMERIO_APP_API_KEY>
//   { transactional_message_id, to, identifiers: { email }, message_data }
// EU region uses https://api-eu.customer.io/v1/send/email.
//
// IMPORTANT: verify the templateId values and message_data keys match your
// Customer.io templates. The variable names below are what the canvas design
// doc specified; if your templates use different names, adjust the
// `buildMessageData` callers below.

const SEND_TIMEOUT_MS = 8000;

function endpointForRegion(region) {
  const value = String(region || "us").toLowerCase();
  if (value === "eu") return "https://api-eu.customer.io/v1/send/email";
  return "https://api.customer.io/v1/send/email";
}

function redactErrorMessage(message, apiKey) {
  if (!message) return "Email send failed.";
  const cleaned = String(message);
  if (!apiKey) return cleaned;
  return cleaned.split(apiKey).join("[redacted]");
}

async function sendWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hasRealConfig(config) {
  return Boolean(config?.customerioAppApiKey);
}

function logDemoSend(label, { to, templateId, link }) {
  // In development we print the full URL so the developer can click it. In
  // production-with-demo-mode-on (which check-production-readiness.mjs
  // already rejects), we redact the token to prevent log exfiltration from
  // creating a working credential.
  const isProduction = process.env.NODE_ENV === "production";
  const displayLink = link
    ? (isProduction ? `${link.split("?")[0]}?token=[redacted]` : link)
    : "";
  console.log(`[email:demo] ${label} -> ${to} via template ${templateId || "(none)"} ${displayLink}`);
}

async function sendTransactionalEmail(config, { templateId, to, messageData, debugLabel }) {
  if (!to) {
    throw new Error("Missing recipient email.");
  }

  // Demo-mode branch first: it must work without any Customer.io config at
  // all (no API key, no template id). This is what makes local development
  // and the integration test suite usable without burning real CIO sends or
  // depending on real credentials.
  if (!hasRealConfig(config)) {
    if (!config?.allowDemoMode) {
      throw new Error("Customer.io is not configured and demo mode is disabled.");
    }
    logDemoSend(debugLabel || "transactional", {
      to,
      templateId,
      link: messageData?.invite_url || messageData?.reset_url,
    });
    return { ok: true, mode: "demo" };
  }

  // Live-send path requires a template id. We only check this once we know
  // we are actually going to hit Customer.io.
  if (!templateId) {
    throw new Error("Missing Customer.io transactional template id.");
  }

  const url = endpointForRegion(config.customerioRegion);
  let response;
  try {
    response = await sendWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.customerioAppApiKey}`,
      },
      body: JSON.stringify({
        transactional_message_id: templateId,
        to,
        identifiers: { email: to },
        message_data: messageData || {},
        from: config.customerioFromName ? config.customerioFromName : undefined,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Customer.io request timed out.");
    }
    throw new Error(redactErrorMessage(error.message, config.customerioAppApiKey));
  }

  if (!response.ok) {
    const status = response.status;
    const fallback = `Customer.io returned HTTP ${status}.`;
    const body = await response.text().catch(() => "");
    const detail = body ? `${fallback} ${body.slice(0, 200)}` : fallback;
    throw new Error(redactErrorMessage(detail, config.customerioAppApiKey));
  }

  return { ok: true, mode: "live" };
}

export async function sendInviteEmail(config, { to, displayName, inviteUrl, expiresInHours }) {
  return sendTransactionalEmail(config, {
    templateId: config.customerioInviteTemplateId,
    to,
    debugLabel: "invite",
    messageData: {
      recipient_email: to,
      display_name: displayName || to,
      invite_url: inviteUrl,
      expires_in_hours: expiresInHours,
    },
  });
}

export async function sendResetEmail(config, { to, displayName, resetUrl, expiresInHours }) {
  return sendTransactionalEmail(config, {
    templateId: config.customerioResetTemplateId,
    to,
    debugLabel: "reset",
    messageData: {
      recipient_email: to,
      display_name: displayName || to,
      reset_url: resetUrl,
      expires_in_hours: expiresInHours,
    },
  });
}

export function hasCustomerioConfig(config) {
  return hasRealConfig(config);
}
