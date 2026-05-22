// Admin-only account listing and removal. The last-admin guard prevents
// locking the deployment out of its own admin surface.

import { validateEmail } from "../security.mjs";
import { requireAdmin, requireAuth } from "../middleware.mjs";
import { findByEmail, sanitize } from "../accountsRepository.mjs";

export function registerAdminAccountRoutes(app, { accounts }) {
  app.get("/accounts", requireAuth, requireAdmin, async (_req, res) => {
    const list = await accounts.readNormalized();
    res.json(list.map(sanitize));
  });

  app.delete("/accounts/:email", requireAuth, requireAdmin, async (req, res) => {
    let emailValue;
    try {
      emailValue = validateEmail(decodeURIComponent(String(req.params.email || "")));
    } catch {
      return res.status(400).json({ error: "Invalid email." });
    }
    const list = await accounts.readNormalized();
    const target = findByEmail(list, emailValue);
    if (!target) {
      return res.status(404).json({ error: "Account not found." });
    }
    if (target.role === "admin") {
      const adminCount = list.filter((account) => account.role === "admin").length;
      if (adminCount <= 1) {
        return res.status(400).json({ error: "Cannot remove the last admin account." });
      }
    }
    const next = list.filter((account) => account.email !== target.email);
    await accounts.write(next);
    return res.status(204).send();
  });
}
