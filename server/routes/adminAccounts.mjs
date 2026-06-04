// Admin-only account listing and removal. The last-admin guard prevents
// locking the deployment out of its own admin surface.

import { validateEmail } from "../security.mjs";
import { requireAdmin, requireAuth } from "../middleware.mjs";

export function registerAdminAccountRoutes(app, { accounts }) {
  app.get("/accounts", requireAuth, requireAdmin, async (_req, res) => {
    res.json(await accounts.listSanitized());
  });

  app.delete("/accounts/:email", requireAuth, requireAdmin, async (req, res) => {
    let emailValue;
    try {
      emailValue = validateEmail(decodeURIComponent(String(req.params.email || "")));
    } catch {
      return res.status(400).json({ error: "Invalid email." });
    }
    try {
      await accounts.deleteAccount(emailValue);
      return res.status(204).send();
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message || "Could not remove account." });
    }
  });
}
