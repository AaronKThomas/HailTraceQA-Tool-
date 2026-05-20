// One-time token helpers for invite + password-reset flows.
//
// Design:
// - 32 random bytes (256 bits) from a CSPRNG, encoded as base64url for URL
//   safety. That is the value sent in the email link.
// - We persist only sha256(rawToken). The raw token never lands on disk.
//   sha256 is fine here because the raw token already has 256 bits of entropy
//   — slow hashing (scrypt/argon2) is only needed for low-entropy user
//   passwords.
// - Tokens are single-use and time-limited. The caller is responsible for
//   clearing the persisted hash once consumed and refusing expired hashes.
// - All comparisons use timing-safe equality so an attacker cannot probe
//   stored hashes byte-by-byte by measuring response time.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

/**
 * Default TTLs per purpose. Reset tokens are intentionally short-lived
 * because a stolen reset link is the most dangerous variety.
 */
export const TOKEN_TTL_MS = {
  invite: 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

export function hashToken(rawToken) {
  return createHash("sha256").update(String(rawToken)).digest("hex");
}

/**
 * Generate a fresh token. Returns the raw token (send in the email URL) and
 * the hash (persist this on the account). The caller chooses the purpose so
 * the right TTL is applied.
 */
export function createToken(purpose, now = Date.now()) {
  const ttl = TOKEN_TTL_MS[purpose];
  if (!ttl) {
    throw new Error(`Unknown token purpose: ${purpose}`);
  }
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    raw,
    record: {
      hash: hashToken(raw),
      purpose,
      createdAt: now,
      expiresAt: now + ttl,
    },
  };
}

/**
 * Verify a raw token against a stored token record. Returns true only if:
 * - The record exists.
 * - The stored purpose matches what the caller expected.
 * - The record has not expired.
 * - The sha256 of the raw token matches the stored hash (timing-safe).
 *
 * NOTE: This function does not consume the token. The caller must clear the
 * persisted record after a successful operation.
 */
export function verifyToken(rawToken, record, expectedPurpose, now = Date.now()) {
  if (!record || !record.hash || !record.purpose || !record.expiresAt) return false;
  if (record.purpose !== expectedPurpose) return false;
  if (record.expiresAt < now) return false;

  const candidate = Buffer.from(hashToken(rawToken), "hex");
  const stored = Buffer.from(record.hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export function isTokenExpired(record, now = Date.now()) {
  if (!record || !record.expiresAt) return true;
  return record.expiresAt < now;
}
