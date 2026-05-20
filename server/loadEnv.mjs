import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnvFile(envPath, { override = false } = {}) {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (override || !(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[config] Could not read ${envPath}: ${error.message}`);
    }
  }
}

export async function loadEnv(rootDir = path.join(__dirname, "..")) {
  await loadEnvFile(path.join(rootDir, ".env"));

  const nodeEnv = String(process.env.NODE_ENV || "").trim();
  if (nodeEnv) {
    await loadEnvFile(path.join(rootDir, `.env.${nodeEnv}`), { override: true });
  }
}
