// All per-endpoint rate limiters in one place so the policy is easy to audit.
//
// forgotByEmail and forgotByIp are split intentionally — together they
// throttle BOTH per-email harassment (one victim, many reset requests) AND
// broad credential bombing (one attacker, many targets). The /forgot-password
// route checks them silently and always returns 200 to prevent enumeration.

import { createRateLimiter } from "./security.mjs";

export function createRateLimiters() {
  return {
    auth: createRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10, keyPrefix: "auth" }),
    register: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 20, keyPrefix: "register" }),
    runTest: createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 30, keyPrefix: "run-test" }),
    notification: createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 20, keyPrefix: "notify" }),
    jira: createRateLimiter({ windowMs: 5 * 60 * 1000, limit: 60, keyPrefix: "jira" }),
    invite: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 20, keyPrefix: "invite" }),
    forgotByEmail: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 5, keyPrefix: "forgot-email" }),
    forgotByIp: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 10, keyPrefix: "forgot-ip" }),
    consume: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 10, keyPrefix: "consume" }),
    tokenValidate: createRateLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyPrefix: "token-validate" }),
  };
}
