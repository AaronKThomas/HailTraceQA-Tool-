// Read-only smoke test against a running backend.
//
// Usage:
//   npm run smoke
//   SMOKE_BASE_URL=http://localhost:3001 npm run smoke
//   SMOKE_ADMIN_EMAIL=admin@example.com SMOKE_ADMIN_PASSWORD=... npm run smoke
//   SMOKE_REQUIRE_INTEGRATIONS=true npm run smoke
//
// Design rules:
//   * Never mutates real account state. /register, /invite, /reset-password
//     are intentionally NOT exercised here because they write to
//     data/accounts.json.
//   * /forgot-password is safe to probe because it is documented to always
//     return 200 regardless of whether the email exists (anti-enumeration).
//     The fake email below has no chance of matching a real tester.
//   * The optional admin login probe runs only when both SMOKE_ADMIN_EMAIL
//     and SMOKE_ADMIN_PASSWORD are set. It performs login -> /session ->
//     logout and never persists anything.
//   * Third-party integrations (OpenAI/Jira/HailTrace/Slack/Zoho) are
//     reported but do NOT fail the smoke by default, because reachability
//     of external services is outside the backend's contract. Set
//     SMOKE_REQUIRE_INTEGRATIONS=true to flip integration "error" states
//     into hard failures (useful for production pre-deploy checks).
//
// Exit codes:
//   0 - all required probes passed
//   1 - one or more required probes failed
//   2 - could not reach the backend at all

const BASE_URL = (process.env.SMOKE_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 5000);
const FAKE_FORGOT_EMAIL = "smoke-no-such-account@invalid.test";

const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "";
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || "";
const requireIntegrations = String(process.env.SMOKE_REQUIRE_INTEGRATIONS || "").toLowerCase() === "true";

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL";
  const line = `[${tag}] ${name}${detail ? ` — ${detail}` : ""}`;
  if (status === "fail") {
    console.error(line);
  } else {
    console.log(line);
  }
}

async function request(pathname, { method = "GET", body, cookie } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    }
    return {
      status: response.status,
      json,
      text,
      setCookie: response.headers.get("set-cookie") || "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pickSessionCookie(setCookieHeader) {
  // Express may emit one or more Set-Cookie headers joined by commas.
  // We only need the name=value pair before the first attribute.
  if (!setCookieHeader) return "";
  const candidates = setCookieHeader.split(/,(?=[^ ]+=)/);
  for (const raw of candidates) {
    const [pair] = raw.split(";");
    if (pair && pair.includes("=")) return pair.trim();
  }
  return "";
}

async function probeHealth() {
  const res = await request("/health");
  if (res.status !== 200) {
    record("GET /health", "fail", `status=${res.status}`);
    return false;
  }
  if (!res.json || res.json.ok !== true) {
    record("GET /health", "fail", "missing ok:true in body");
    return false;
  }
  const mode = res.json.mode || "unknown";
  record("GET /health", "pass", `mode=${mode}`);
  return true;
}

async function probeHealthIntegrations() {
  const res = await request("/health/integrations");
  if (res.status !== 200) {
    record("GET /health/integrations", "fail", `status=${res.status}`);
    return false;
  }
  if (!res.json || typeof res.json.integrations !== "object") {
    record("GET /health/integrations", "fail", "missing integrations object");
    return false;
  }

  // Probe states from server/probes.mjs: connected | configured | demo |
  // warning | error. "error" means a configured integration could not be
  // reached — that is a real smoke failure even if /health says "live".
  const broken = [];
  const live = [];
  const demo = [];
  for (const [name, value] of Object.entries(res.json.integrations)) {
    const state = value?.state || "unknown";
    if (state === "error") broken.push(`${name}: ${value?.message || "error"}`);
    else if (state === "connected" || state === "configured") live.push(name);
    else if (state === "demo") demo.push(name);
  }

  const liveSummary = live.length ? `live: ${live.join(", ")}` : "no live integrations";
  const demoSummary = demo.length ? `; demo: ${demo.join(", ")}` : "";
  const brokenSummary = broken.length ? `; unreachable -> ${broken.join("; ")}` : "";

  if (broken.length > 0 && requireIntegrations) {
    record("GET /health/integrations", "fail", `unreachable -> ${broken.join("; ")}`);
    return false;
  }

  record(
    "GET /health/integrations",
    "pass",
    `${liveSummary}${demoSummary}${brokenSummary}${broken.length && !requireIntegrations ? " (informational; set SMOKE_REQUIRE_INTEGRATIONS=true to fail)" : ""}`,
  );
  return true;
}

async function probeSessionAnonymous() {
  const res = await request("/session");
  if (res.status !== 200) {
    record("GET /session (anonymous)", "fail", `status=${res.status}`);
    return false;
  }
  if (!res.json || res.json.authenticated !== false) {
    record("GET /session (anonymous)", "fail", "expected authenticated:false");
    return false;
  }
  record("GET /session (anonymous)", "pass");
  return true;
}

async function probeForgotPassword() {
  const res = await request("/forgot-password", {
    method: "POST",
    body: { email: FAKE_FORGOT_EMAIL },
  });
  if (res.status !== 200) {
    record("POST /forgot-password", "fail", `expected 200, got ${res.status}`);
    return false;
  }
  if (!res.json || res.json.ok !== true) {
    record("POST /forgot-password", "fail", "expected { ok: true }");
    return false;
  }
  record("POST /forgot-password", "pass", "constant-response contract holds");
  return true;
}

async function probeLoginRejectsBadCreds() {
  const res = await request("/login", {
    method: "POST",
    body: { email: "smoke-bad-creds@invalid.test", password: "definitely-not-real" },
  });
  if (res.status === 401) {
    record("POST /login (bad creds)", "pass", "401 as expected");
    return true;
  }
  if (res.status === 429) {
    record("POST /login (bad creds)", "skip", "rate limited (acceptable)");
    return true;
  }
  record("POST /login (bad creds)", "fail", `expected 401, got ${res.status}`);
  return false;
}

async function probeAdminRoundTrip() {
  if (!adminEmail || !adminPassword) {
    record("admin login round-trip", "skip", "SMOKE_ADMIN_EMAIL/PASSWORD not set");
    return true;
  }

  const loginRes = await request("/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
  if (loginRes.status !== 200) {
    record("admin POST /login", "fail", `status=${loginRes.status}`);
    return false;
  }
  const cookie = pickSessionCookie(loginRes.setCookie);
  if (!cookie) {
    record("admin POST /login", "fail", "no session cookie returned");
    return false;
  }
  record("admin POST /login", "pass");

  const sessionRes = await request("/session", { cookie });
  if (sessionRes.status !== 200 || !sessionRes.json?.authenticated) {
    record("admin GET /session", "fail", `status=${sessionRes.status}`);
    return false;
  }
  if (sessionRes.json.account?.email?.toLowerCase() !== adminEmail.toLowerCase()) {
    record("admin GET /session", "fail", "email mismatch on session payload");
    return false;
  }
  record("admin GET /session", "pass", `role=${sessionRes.json.account?.role || "?"}`);

  const logoutRes = await request("/logout", { method: "POST", cookie });
  if (logoutRes.status !== 204) {
    record("admin POST /logout", "fail", `expected 204, got ${logoutRes.status}`);
    return false;
  }
  record("admin POST /logout", "pass");
  return true;
}

async function main() {
  console.log(`Smoke target: ${BASE_URL}`);
  console.log("");

  try {
    await request("/health");
  } catch (error) {
    console.error(`[FATAL] Could not reach backend at ${BASE_URL}: ${error.message}`);
    console.error("Hint: start it with `npm run start:dev` in another terminal.");
    process.exit(2);
  }

  const checks = [
    probeHealth,
    probeHealthIntegrations,
    probeSessionAnonymous,
    probeForgotPassword,
    probeLoginRejectsBadCreds,
    probeAdminRoundTrip,
  ];

  let allOk = true;
  for (const check of checks) {
    try {
      const ok = await check();
      if (!ok) allOk = false;
    } catch (error) {
      record(check.name || "check", "fail", error.message);
      allOk = false;
    }
  }

  console.log("");
  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(`Summary: ${passed} passed, ${skipped} skipped, ${failed} failed`);

  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(`[FATAL] Smoke run crashed: ${error.message}`);
  process.exit(1);
});
