export function readJson(key, fallback = null) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    // Local preview should keep working even if storage is blocked or cleared.
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Per-user namespace for locally persisted workspace state (history, settings,
// templates, suites). Shared so every reader/writer agrees on the key format.
export function getUserKey(prefix, email) {
  return `${prefix}:${String(email || "").toLowerCase()}`;
}
