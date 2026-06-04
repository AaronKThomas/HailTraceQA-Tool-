import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_IPV4_CIDRS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const TELEMETRY_HOST_PATTERNS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)analytics\.google\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)posthog\.com$/i,
];

const TELEMETRY_PATH_PATTERNS = [
  /\/_posthog(\/|$)/i,
  /\/_ph(\/|$)/i,
];

function stripIpv6Brackets(value) {
  const text = String(value || "").trim();
  return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
}

function ipV4ToNumber(ip) {
  return ip
    .split(".")
    .reduce((acc, part) => (acc * 256) + Number(part), 0);
}

function isIpV4InCidr(ip, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipV4ToNumber(ip) & mask) === (ipV4ToNumber(base) & mask);
}

function isBlockedIpV4Address(address) {
  return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => isIpV4InCidr(address, base, prefix));
}

function hextetToOctets(value) {
  const parsed = Number.parseInt(value, 16);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) return null;
  return [Math.floor(parsed / 256), parsed % 256];
}

function extractIpv4MappedAddress(address) {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  const dottedPrefix = "::ffff:";
  if (normalized.startsWith(dottedPrefix)) {
    const suffix = normalized.slice(dottedPrefix.length);
    if (net.isIP(suffix) === 4) return suffix;

    const parts = suffix.split(":");
    if (parts.length === 2) {
      const high = hextetToOctets(parts[0]);
      const low = hextetToOctets(parts[1]);
      if (high && low) return [...high, ...low].join(".");
    }
  }

  const expanded = normalized.match(/^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!expanded) return null;

  const high = hextetToOctets(expanded[1]);
  const low = hextetToOctets(expanded[2]);
  return high && low ? [...high, ...low].join(".") : null;
}

export function isBlockedIpAddress(address) {
  const normalizedAddress = stripIpv6Brackets(address);
  const mappedIpV4Address = extractIpv4MappedAddress(normalizedAddress);
  if (mappedIpV4Address) return isBlockedIpV4Address(mappedIpV4Address);

  const ipVersion = net.isIP(normalizedAddress);
  if (ipVersion === 4) return isBlockedIpV4Address(normalizedAddress);

  if (ipVersion === 6) {
    const normalized = normalizedAddress.toLowerCase();
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe8")
      || normalized.startsWith("fe9")
      || normalized.startsWith("fea")
      || normalized.startsWith("feb")
      || normalized.startsWith("ff");
  }

  return true;
}

function isBlockedHostname(hostname) {
  const value = stripIpv6Brackets(hostname).toLowerCase();
  return value === "localhost"
    || value.endsWith(".localhost")
    || value === "metadata.google.internal";
}

// Validates that a hostname is safe to reach and returns the concrete public IP
// it resolves to. Returning the IP lets callers pin the connection to that
// exact address, closing the DNS-rebinding window between this check and the
// actual request.
async function resolvePublicHostname(hostname) {
  const normalizedHostname = stripIpv6Brackets(hostname);
  if (net.isIP(normalizedHostname)) {
    if (isBlockedIpAddress(normalizedHostname)) {
      throw new Error("Private, local, or reserved IP addresses cannot be tested.");
    }
    return normalizedHostname;
  }

  if (isBlockedHostname(normalizedHostname)) {
    throw new Error("Local hostnames cannot be tested.");
  }

  const addresses = await dns.lookup(normalizedHostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error("Website hostname could not be resolved.");
  }

  const blocked = addresses.find((entry) => isBlockedIpAddress(entry.address));
  if (blocked) {
    throw new Error("Website resolves to a private, local, or reserved IP address.");
  }

  return addresses[0].address;
}

export function isTelemetryRequest(value) {
  try {
    const url = new URL(String(value || ""));
    if (TELEMETRY_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))) return true;
    return TELEMETRY_PATH_PATTERNS.some((pattern) => pattern.test(url.pathname));
  } catch {
    return false;
  }
}

export function extractFirstHttpUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"')]+/i);
  if (!match) return "";
  return match[0].replace(/[.,;:!?]+$/, "");
}

export function redactUrlForLog(value) {
  try {
    const url = new URL(String(value || ""));
    url.username = "";
    url.password = "";
    const hadSearch = Boolean(url.search);
    url.search = "";
    url.hash = "";
    return `${url.toString()}${hadSearch ? "?[redacted]" : ""}`;
  } catch {
    return String(value || "").replace(/https?:\/\/\S+/gi, "[redacted-url]");
  }
}

// Validates a website URL and returns the normalized URL plus the public IP it
// resolves to. Callers that open a real connection should pin to this IP to
// prevent DNS rebinding.
export async function assertSafeWebsiteTarget(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("A valid http:// or https:// website URL is required.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// website URLs can be tested.");
  }

  url.hash = "";
  const ip = await resolvePublicHostname(url.hostname);
  return { url: url.toString(), hostname: stripIpv6Brackets(url.hostname), ip };
}

export async function assertSafeWebsiteUrl(value) {
  return (await assertSafeWebsiteTarget(value)).url;
}

export function ensureSameOrigin(url, origin, message = "Action plans may not navigate away from the original website origin.") {
  if (new URL(url).origin !== origin) {
    throw new Error(message);
  }
}
