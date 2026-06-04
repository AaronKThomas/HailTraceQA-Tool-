import path from "node:path";

import { requireAuth } from "../middleware.mjs";
import { getVideoReplayArtifact } from "../testArtifacts.mjs";

export function registerTestArtifactRoutes(app, { config }) {
  app.get("/test-artifacts/:id/video", requireAuth, async (req, res) => {
    try {
      const artifact = await getVideoReplayArtifact({
        artifactsDir: config.testArtifactsDir,
        id: req.params.id,
        ownerEmail: req.user.email,
      });

      res.setHeader("Content-Type", artifact.contentType);
      res.setHeader("Cache-Control", "private, no-store");
      return res.sendFile(path.resolve(artifact.filePath));
    } catch {
      return res.status(404).json({ error: "Artifact not found." });
    }
  });
}
