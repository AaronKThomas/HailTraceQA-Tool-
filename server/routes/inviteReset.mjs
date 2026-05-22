// Invite + password-reset flows.
//
// Security invariants enforced here:
//  * Tokens are 32 random bytes, sha256-hashed at rest, single-use, and
//    time-limited (see ../tokens.mjs).
//  * /forgot-password always returns 200 with the same body — no enumeration.
//  * Successful password change ALWAYS bumps sessionVersion, which
//    invalidates every existing cookie for that account on the next request.
//  * /invite is fail-closed: the persisted change only lands on disk AFTER
//    Customer.io accepts the message. A failing send cannot create an orphan
//    account whose owner never receives a link.
//  * The raw token only appears in the email URL and in memory during
//    request processing. accounts.json stores the sha256 hash.

import {
  getClientIp,
  hashPassword,
  setSessionCookie,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "../security.mjs";
import {
  applyRateLimit,
  isSecureRequest,
  requireAdmin,
  requireAuth,
} from "../middleware.mjs";
import { ensureSessionSecret } from "../config.mjs";
import { findByEmail, sanitize } from "../accountsRepository.mjs";
import { createToken, hashToken, isTokenExpired, TOKEN_TTL_MS } from "../tokens.mjs";
import { sendInviteEmail, sendResetEmail } from "../email.mjs";

function findAccountByTokenHash(accounts, tokenHash, expectedPurpose) {
  if (!tokenHash) return null;
  return accounts.find((account) => {
    const record = account.pendingToken;
    if (!record || record.hash !== tokenHash) return false;
    if (record.purpose !== expectedPurpose) return false;
    if (isTokenExpired(record)) return false;
    return true;
  }) || null;
}

export function registerInviteResetRoutes(app, { config, accounts, rateLimits }) {
  const buildAcceptInviteUrl = (raw) =>
    `${config.appPublicUrl}/accept-invite?token=${encodeURIComponent(raw)}`;
  const buildResetUrl = (raw) =>
    `${config.appPublicUrl}/reset-password?token=${encodeURIComponent(raw)}`;

  app.post("/invite", requireAuth, requireAdmin, async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.invite, "invitation")) return undefined;
    try {
      const { email, displayName } = req.body || {};
      if (!email || !displayName) {
        return res.status(400).json({ error: "Email and display name are required." });
      }
      const emailValue = validateEmail(email);
      const displayNameValue = validateDisplayName(displayName);

      const list = await accounts.readNormalized();
      const existing = findByEmail(list, emailValue);
      if (existing && existing.status === "active") {
        return res.status(409).json({ error: "An active account already exists for this email." });
      }

      const { raw: rawToken, record } = createToken("invite");
      const expiresInHours = Math.round(TOKEN_TTL_MS.invite / 3_600_000);
      const now = new Date().toISOString();

      const nextAccount = existing
        ? {
          ...existing,
          displayName: displayNameValue,
          pendingToken: record,
        }
        : {
          email: emailValue,
          displayName: displayNameValue,
          role: "tester",
          status: "pending",
          sessionVersion: 0,
          pendingToken: record,
          passwordHash: "",
          passwordSalt: "",
          registeredAt: now,
        };

      // Send email FIRST so a delivery failure prevents any account from
      // being persisted. The raw token only exists in the email URL.
      try {
        await sendInviteEmail(config, {
          to: emailValue,
          displayName: displayNameValue,
          inviteUrl: buildAcceptInviteUrl(rawToken),
          expiresInHours,
        });
      } catch (error) {
        console.warn(`[invite] Could not send invite to ${emailValue}: ${error.message}`);
        return res.status(502).json({ error: "Could not send invite email. Please try again." });
      }

      const nextList = existing
        ? list.map((account) => account.email === existing.email ? nextAccount : account)
        : [...list, nextAccount];
      await accounts.write(nextList);

      return res.status(201).json({ account: sanitize(nextAccount) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Invite failed." });
    }
  });

  app.get("/invite/:token", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.tokenValidate, "token validation")) return undefined;
    const rawToken = String(req.params.token || "");
    const tokenHash = rawToken ? hashToken(rawToken) : null;
    const list = await accounts.readNormalized();
    const match = findAccountByTokenHash(list, tokenHash, "invite");
    if (!match) return res.json({ valid: false });
    return res.json({
      valid: true,
      email: match.email,
      displayName: match.displayName,
      expiresAt: match.pendingToken.expiresAt,
    });
  });

  app.post("/accept-invite", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.consume, "invite acceptance")) return undefined;
    try {
      const { token, password, displayName } = req.body || {};
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required." });
      }
      const passwordValue = validatePassword(password);
      const trimmedDisplayName = typeof displayName === "string" && displayName.trim()
        ? validateDisplayName(displayName)
        : null;

      const tokenHash = hashToken(String(token));
      const list = await accounts.readNormalized();
      const match = findAccountByTokenHash(list, tokenHash, "invite");
      if (!match) {
        return res.status(400).json({ error: "This invite link is invalid or has expired." });
      }

      const passwordData = await hashPassword(passwordValue);
      const updated = {
        ...match,
        ...passwordData,
        status: "active",
        pendingToken: null,
        displayName: trimmedDisplayName || match.displayName,
        sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
      };

      await accounts.write(list.map((account) => account.email === match.email ? updated : account));
      ensureSessionSecret(config);
      setSessionCookie(res, config.sessionSecret, updated, isSecureRequest(req));
      return res.status(200).json({ account: sanitize(updated) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Could not accept invite." });
    }
  });

  app.post("/forgot-password", async (req, res) => {
    // Always returns 200 with the same body so attackers cannot enumerate
    // accounts or rate-limit state from the outside.
    const respondOk = () => res.json({ ok: true });

    const ip = getClientIp(req);
    if (!rateLimits.forgotByIp(ip).ok) {
      console.warn(`[forgot-password] IP rate limit hit for ${ip}`);
      return respondOk();
    }

    let emailValue = "";
    try {
      emailValue = validateEmail(String(req.body?.email || ""));
    } catch {
      return respondOk();
    }

    if (!rateLimits.forgotByEmail(emailValue).ok) {
      console.warn(`[forgot-password] Email rate limit hit for ${emailValue}`);
      return respondOk();
    }

    const list = await accounts.readNormalized();
    const match = findByEmail(list, emailValue);
    if (!match || match.status !== "active") {
      return respondOk();
    }

    const { raw: rawToken, record } = createToken("reset");
    const updated = { ...match, pendingToken: record };
    await accounts.write(list.map((account) => account.email === match.email ? updated : account));

    const expiresInHours = Math.max(1, Math.round(TOKEN_TTL_MS.reset / 3_600_000));
    try {
      await sendResetEmail(config, {
        to: match.email,
        displayName: match.displayName,
        resetUrl: buildResetUrl(rawToken),
        expiresInHours,
      });
    } catch (error) {
      // Intentionally do not surface delivery failures here. The user must
      // not learn whether their email exists; operators see logs.
      console.warn(`[forgot-password] Send failed for ${match.email}: ${error.message}`);
    }
    return respondOk();
  });

  app.get("/reset/:token", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.tokenValidate, "token validation")) return undefined;
    const rawToken = String(req.params.token || "");
    const tokenHash = rawToken ? hashToken(rawToken) : null;
    const list = await accounts.readNormalized();
    const match = findAccountByTokenHash(list, tokenHash, "reset");
    if (!match) return res.json({ valid: false });
    return res.json({
      valid: true,
      email: match.email,
      displayName: match.displayName,
      expiresAt: match.pendingToken.expiresAt,
    });
  });

  app.post("/reset-password", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.consume, "password reset")) return undefined;
    try {
      const { token, password } = req.body || {};
      if (!token || !password) {
        return res.status(400).json({ error: "Token and password are required." });
      }
      const passwordValue = validatePassword(password);

      const tokenHash = hashToken(String(token));
      const list = await accounts.readNormalized();
      const match = findAccountByTokenHash(list, tokenHash, "reset");
      if (!match) {
        return res.status(400).json({ error: "This reset link is invalid or has expired." });
      }

      const passwordData = await hashPassword(passwordValue);
      const updated = {
        ...match,
        ...passwordData,
        pendingToken: null,
        // sessionVersion bump invalidates every existing cookie for this
        // account on the next request, including any hijacker's session.
        sessionVersion: (Number.isInteger(match.sessionVersion) ? match.sessionVersion : 0) + 1,
      };

      await accounts.write(list.map((account) => account.email === match.email ? updated : account));
      // Do NOT issue a session cookie. Reset is not the same as login.
      return res.status(204).send();
    } catch (error) {
      return res.status(400).json({ error: error.message || "Could not reset password." });
    }
  });
}
