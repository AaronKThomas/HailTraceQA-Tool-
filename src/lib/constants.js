export const CONFIG_DEFAULTS = {
  backendUrl: "http://localhost:3001",
};

export const STATUS = {
  idle: "idle",
  running: "running",
  pass: "pass",
  fail: "fail",
  manual: "manual",
};

export const STATUS_CONFIG = {
  idle: { label: "Queued", bg: "var(--surface)", border: "var(--border-mid)", text: "var(--muted)", dot: "var(--faint)" },
  running: { label: "Running", bg: "var(--run-light)", border: "var(--run-border)", text: "var(--accent)", dot: "var(--accent)" },
  pass: { label: "Pass", bg: "var(--pass-light)", border: "var(--pass-border)", text: "var(--pass)", dot: "var(--pass)" },
  fail: { label: "Fail", bg: "var(--fail-light)", border: "var(--fail-border)", text: "var(--fail)", dot: "var(--fail)" },
  manual: { label: "Manual", bg: "var(--warn-light)", border: "var(--warn-border)", text: "var(--warn)", dot: "var(--warn)" },
};

export const SECTION_HEADERS = [
  "WHAT IS BEING TESTED",
  "API RESULTS",
  "CODE ANALYSIS",
  "ERROR LOCATION",
  "RECOMMENDATIONS",
];

export const ALL_TABS = ["tests", "history", "settings", "templates", "suites", "dashboard"];

export const DASHBOARD_ENDPOINTS = [
  { label: "Health", method: "GET", path: "/health" },
  { label: "Accounts", method: "GET", path: "/accounts" },
  { label: "Run Test", method: "POST", path: "/run-test" },
];

export const defaultSettings = {
  backendUrl: CONFIG_DEFAULTS.backendUrl,
  soundOnComplete: false,
  exportFormat: "txt",
  displayName: "",
  theme: "dark",
};
