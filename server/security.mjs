import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE = "hailtrace_qa_session";
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(secret, value) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

export function buildCorsOptions(allowedOrigins) {
  const allowed = new Set(allowedOrigins.filter(Boolean));
  return {
    origin(origin, callback) {
      if (!origin || allowed.size === 0 || allowed.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS policy"));
    },
    credentials: true,
  };
}

export function applySecurityHeaders(req, res, next) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' http://localhost:3001 http://127.0.0.1:3001",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return {
    passwordSalt: salt,
    passwordHash: Buffer.from(derived).toString("hex"),
  };
}

export async function verifyPassword(password, account) {
  if (!account?.passwordSalt || !account?.passwordHash) {
    return false;
  }
  const derived = await scrypt(password, account.passwordSalt, 64);
  const candidate = Buffer.from(derived).toString("hex");
  const left = Buffer.from(candidate, "hex");
  const right = Buffer.from(account.passwordHash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index === -1) return acc;
      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

export function createSessionCookie(secret, account, now = Date.now()) {
  const payload = {
    username: account.username,
    displayName: account.displayName,
    role: account.role || "tester",
    issuedAt: now,
    expiresAt: now + DEFAULT_SESSION_TTL_MS,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signValue(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function readSessionCookie(secret, cookieValue) {
  if (!secret || !cookieValue || !cookieValue.includes(".")) return null;
  const [encodedPayload, signature] = cookieValue.split(".");
  const expected = signValue(secret, encodedPayload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload));
    if (!payload?.username || !payload?.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, secret, account, isSecure) {
  const value = encodeURIComponent(createSessionCookie(secret, account));
  const cookie = [
    `${SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(DEFAULT_SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecure) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

export function clearSessionCookie(res, isSecure) {
  const cookie = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecure) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function createRateLimiter({ windowMs, limit, keyPrefix }) {
  const entries = new Map();

  return function rateLimit(key) {
    const now = Date.now();
    const compositeKey = `${keyPrefix}:${key}`;
    const current = entries.get(compositeKey);
    if (!current || now - current.startedAt >= windowMs) {
      entries.set(compositeKey, { startedAt: now, count: 1 });
      return { ok: true, remaining: limit - 1 };
    }

    if (current.count >= limit) {
      return {
        ok: false,
        retryAfterMs: windowMs - (now - current.startedAt),
        remaining: 0,
      };
    }

    current.count += 1;
    entries.set(compositeKey, current);
    return { ok: true, remaining: limit - current.count };
  };
}

export function requireNonEmptyString(value, field, { max = 5000, min = 1 } = {}) {
  const normalized = String(value || "").trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters.`);
  }
  return normalized;
}

export function validateUsername(value) {
  const username = requireNonEmptyString(value, "Username", { min: 3, max: 40 });
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new Error("Username may only contain letters, numbers, dots, underscores, and hyphens.");
  }
  return username;
}

export function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 12 || password.length > 128) {
    throw new Error("Password must be between 12 and 128 characters.");
  }
  return password;
}

export function validateDisplayName(value) {
  return requireNonEmptyString(value, "Display name", { min: 2, max: 80 });
}
