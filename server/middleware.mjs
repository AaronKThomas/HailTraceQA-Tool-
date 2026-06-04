// Cross-cutting HTTP middleware: session attachment, auth guards, rate-limit
// helper, demo-mode gate, and the small isSecureRequest predicate.

import {
  getClientIp,
  getSessionCookieName,
  parseCookies,
  readSessionCookie,
} from "./security.mjs";
import { hasSessionSecret } from "./config.mjs";

export function isSecureRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

// Resolve the client IP once per request, honoring X-Forwarded-For only when
// the deployment is configured to trust a proxy. Downstream rate limiting reads
// req.clientIp so the trust decision lives in exactly one place.
export function createClientIpMiddleware({ config }) {
  return function attachClientIp(req, _res, next) {
    req.clientIp = getClientIp(req, { trustProxy: config.trustProxy });
    next();
  };
}

function rejectRateLimited(res, result, scope) {
  res.setHeader("Retry-After", String(Math.ceil((result.retryAfterMs || 1000) / 1000)));
  res.status(429).json({ error: `Too many ${scope} requests. Please try again later.` });
  return false;
}

// Apply a rate limiter and respond with 429 on overflow. Keying on user+ip
// when authenticated prevents a single account from being squeezed out by
// shared NAT traffic while still bounding per-IP abuse from anonymous users.
export function applyRateLimit(req, res, limiter, scope) {
  const ip = req.clientIp || getClientIp(req);
  const key = req.user ? `${req.user.email}:${ip}` : ip;
  const result = limiter(key);
  if (result.ok) return true;
  return rejectRateLimited(res, result, scope);
}

// Rate limit on an explicit key (e.g. the submitted login email) so a single
// account cannot be brute-forced from many rotating IPs.
export function applyRateLimitForKey(res, limiter, key, scope) {
  const result = limiter(key);
  if (result.ok) return true;
  return rejectRateLimited(res, result, scope);
}

// Re-resolves the account on every request so role/status/sessionVersion
// changes take effect immediately. This is what closes the "demoted admin
// keeps admin power" window AND lets password-reset/invite flows revoke all
// live sessions for a user by bumping sessionVersion.
export function createSessionMiddleware({ config, accounts }) {
  return async function attachSession(req, _res, next) {
    req.cookies = parseCookies(req.headers.cookie || "");
    const sessionValue = req.cookies[getSessionCookieName()];
    req.session = hasSessionSecret(config) ? readSessionCookie(config.sessionSecret, sessionValue) : null;
    req.user = null;

    if (!req.session?.email) {
      next();
      return;
    }

    try {
      const account = await accounts.getByEmail(req.session.email);
      if (!account) { next(); return; }
      if (account.status !== "active") { next(); return; }
      if (account.sessionVersion !== req.session.sessionVersion) { next(); return; }
      req.user = {
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        sessionVersion: account.sessionVersion,
      };
    } catch (error) {
      console.warn(`[auth] Failed to resolve session account: ${error.message}`);
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user?.email) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

export function ensureDemoAllowed(config, res, feature) {
  if (config.allowDemoMode) return true;
  res.status(503).json({
    error: `${feature} is not configured. Demo mode is disabled in production.`,
  });
  return false;
}
