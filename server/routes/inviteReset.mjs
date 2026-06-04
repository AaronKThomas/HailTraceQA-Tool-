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
import { sanitize } from "../accountsRepository.mjs";
import { createToken, TOKEN_TTL_MS } from "../tokens.mjs";
import { sendInviteEmail, sendResetEmail } from "../email.mjs";

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

      const { raw: rawToken, record } = createToken("invite");
      const expiresInHours = Math.round(TOKEN_TTL_MS.invite / 3_600_000);
      const nextAccount = await accounts.issueInvite({
        email: emailValue,
        displayName: displayNameValue,
        tokenRecord: record,
        send: async () => {
          try {
            await sendInviteEmail(config, {
              to: emailValue,
              displayName: displayNameValue,
              inviteUrl: buildAcceptInviteUrl(rawToken),
              expiresInHours,
            });
          } catch (cause) {
            console.warn(`[invite] Could not send invite to ${emailValue}: ${cause.message}`);
            const error = new Error("Could not send invite email. Please try again.");
            error.statusCode = 502;
            throw error;
          }
        },
      });

      return res.status(201).json({ account: sanitize(nextAccount) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || "Invite failed." });
    }
  });

  app.get("/invite/:token", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.tokenValidate, "token validation")) return undefined;
    const rawToken = String(req.params.token || "");
    const match = await accounts.findByRawToken(rawToken, "invite");
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

      const passwordData = await hashPassword(passwordValue);
      const updated = await accounts.consumeInvite({
        rawToken: String(token),
        passwordData,
        displayName: trimmedDisplayName,
      });
      ensureSessionSecret(config);
      setSessionCookie(res, config.sessionSecret, updated, isSecureRequest(req));
      return res.status(200).json({ account: sanitize(updated) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || "Could not accept invite." });
    }
  });

  app.post("/forgot-password", async (req, res) => {
    // Always returns 200 with the same body so attackers cannot enumerate
    // accounts or rate-limit state from the outside.
    const respondOk = () => res.json({ ok: true });

    const ip = req.clientIp || getClientIp(req);
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

    const { raw: rawToken, record } = createToken("reset");
    const match = await accounts.issuePasswordReset({ email: emailValue, tokenRecord: record });
    if (!match) {
      return respondOk();
    }

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
    const match = await accounts.findByRawToken(rawToken, "reset");
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

      const passwordData = await hashPassword(passwordValue);
      await accounts.rotatePasswordWithResetToken({
        rawToken: String(token),
        passwordData,
      });
      // Do NOT issue a session cookie. Reset is not the same as login.
      return res.status(204).send();
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || "Could not reset password." });
    }
  });
}
