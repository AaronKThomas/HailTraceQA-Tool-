import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ARTIFACT_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const METADATA_FILE = "metadata.json";
const VIDEO_FILE = "replay.webm";
const VIDEO_CONTENT_TYPE = "video/webm";

function normalizeOwnerEmail(ownerEmail) {
  const email = String(ownerEmail || "").trim().toLowerCase();
  if (!email) throw new Error("Artifact owner is required.");
  return email;
}

function assertArtifactId(id) {
  const value = String(id || "").trim();
  if (!ARTIFACT_ID_PATTERN.test(value)) {
    throw new Error("Artifact not found.");
  }
  return value;
}

function artifactDir(rootDir, id) {
  return path.join(rootDir, id);
}

async function moveFile(sourcePath, destinationPath) {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs.copyFile(sourcePath, destinationPath);
    await fs.unlink(sourcePath).catch(() => {});
  }
}

async function readMetadata(rootDir, id) {
  const raw = await fs.readFile(path.join(artifactDir(rootDir, id), METADATA_FILE), "utf8");
  return JSON.parse(raw);
}

async function removeExpiredArtifacts(rootDir, nowMs) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && ARTIFACT_ID_PATTERN.test(entry.name))
    .map(async (entry) => {
      try {
        const metadata = await readMetadata(rootDir, entry.name);
        if (Date.parse(metadata.expiresAt) <= nowMs) {
          await fs.rm(artifactDir(rootDir, entry.name), { recursive: true, force: true });
        }
      } catch {
        // Corrupt orphaned artifact directories are not useful to users and may
        // contain stale replay data, so fail closed by deleting them.
        await fs.rm(artifactDir(rootDir, entry.name), { recursive: true, force: true });
      }
    }));
}

export async function createVideoReplayArtifact({
  artifactsDir,
  ownerEmail,
  sourcePath,
  retentionMs,
  now = new Date(),
}) {
  if (!sourcePath) return null;

  const owner = normalizeOwnerEmail(ownerEmail);
  const rootDir = path.resolve(artifactsDir);
  const nowMs = now.getTime();
  const retention = Number.isFinite(Number(retentionMs)) && Number(retentionMs) > 0
    ? Number(retentionMs)
    : 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(nowMs + retention).toISOString();
  const id = randomUUID();
  const dir = artifactDir(rootDir, id);
  const videoPath = path.join(dir, VIDEO_FILE);

  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  await removeExpiredArtifacts(rootDir, nowMs);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await moveFile(sourcePath, videoPath);
  await fs.chmod(videoPath, 0o600).catch(() => {});

  const metadata = {
    id,
    ownerEmail: owner,
    type: "video-replay",
    contentType: VIDEO_CONTENT_TYPE,
    filename: VIDEO_FILE,
    createdAt: now.toISOString(),
    expiresAt,
  };
  await fs.writeFile(path.join(dir, METADATA_FILE), JSON.stringify(metadata, null, 2), { mode: 0o600 });

  return {
    id,
    type: metadata.type,
    contentType: metadata.contentType,
    url: `/test-artifacts/${id}/video`,
    createdAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
  };
}

export async function getVideoReplayArtifact({ artifactsDir, id, ownerEmail, now = new Date() }) {
  const artifactId = assertArtifactId(id);
  const owner = normalizeOwnerEmail(ownerEmail);
  const rootDir = path.resolve(artifactsDir);

  try {
    const metadata = await readMetadata(rootDir, artifactId);
    if (metadata.ownerEmail !== owner || metadata.type !== "video-replay") {
      throw new Error("Artifact not found.");
    }
    if (Date.parse(metadata.expiresAt) <= now.getTime()) {
      await fs.rm(artifactDir(rootDir, artifactId), { recursive: true, force: true });
      throw new Error("Artifact not found.");
    }

    const filePath = path.join(artifactDir(rootDir, artifactId), VIDEO_FILE);
    await fs.access(filePath);
    return {
      filePath,
      contentType: metadata.contentType || VIDEO_CONTENT_TYPE,
    };
  } catch {
    throw new Error("Artifact not found.");
  }
}
