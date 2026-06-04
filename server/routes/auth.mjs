// Core auth routes: login, register (with admin-bootstrap rule), logout,
// session probe. Account creation by an admin lives here too because
// /register is the same code path; the bootstrap branch is what makes the
// first account an admin.

import {
  clearSessionCookie,
  hashPassword,
  setSessionCookie,
  validateDisplayName,
  validateEmail,
  validatePassword,
  verifyPassword,
} from "../security.mjs";
import { applyRateLimit, applyRateLimitForKey, isSecureRequest, requireAuth } from "../middleware.mjs";
import { ensureSessionSecret } from "../config.mjs";
import { sanitize } from "../accountsRepository.mjs";

export function registerAuthRoutes(app, { config, accounts, rateLimits }) {
  app.post("/login", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.auth, "login")) return undefined;
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const emailValue = validateEmail(email);
      if (!applyRateLimitForKey(res, rateLimits.loginByEmail, emailValue, "login")) return undefined;
      const passwordValue = String(password);
      const match = await accounts.getByEmail(emailValue);

      // Generic 401 covers "no account", "wrong password", "pending", and
      // "corrupt record" with the same body to prevent enumeration.
      let authenticated = false;
      if (match && match.status === "active" && match.passwordHash && match.passwordSalt) {
        authenticated = await verifyPassword(passwordValue, match);
      }

      if (!authenticated) {
        return res.status(401).json({ error: "Incorrect email or password." });
      }

      ensureSessionSecret(config);
      setSessionCookie(res, config.sessionSecret, match, isSecureRequest(req));
      return res.json({ account: sanitize(match) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Login failed." });
    }
  });

  app.post("/register", async (req, res) => {
    if (!applyRateLimit(req, res, rateLimits.register, "registration")) return undefined;
    try {
      const { email, displayName, password } = req.body || {};
      if (!email || !displayName || !password) {
        return res.status(400).json({ error: "Email, display name, and password are required." });
      }

      const emailValue = validateEmail(email);
      const displayNameValue = validateDisplayName(displayName);
      const passwordValue = validatePassword(password);
      const passwordData = await hashPassword(passwordValue);
      const { account, isBootstrap } = await accounts.createRegisteredAccount({
        email: emailValue,
        displayName: displayNameValue,
        passwordData,
        actor: req.user,
      });
      if (isBootstrap) {
        ensureSessionSecret(config);
        setSessionCookie(res, config.sessionSecret, account, isSecureRequest(req));
      }
      return res.status(201).json({ account: sanitize(account) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || "Registration failed." });
    }
  });

  app.post("/logout", requireAuth, (req, res) => {
    clearSessionCookie(res, isSecureRequest(req));
    res.status(204).send();
  });

  app.get("/session", (req, res) => {
    if (!req.user?.email) {
      return res.json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      account: {
        email: req.user.email,
        displayName: req.user.displayName,
        role: req.user.role || "tester",
      },
    });
  });
}
