export const CONFIG_DEFAULTS = {
  backendUrl: "http://localhost:3001",
};

export const STATUS = {
  idle: "idle",
  running: "running",
  pass: "pass",
  fail: "fail",
  manual: "manual",
  cancelled: "cancelled",
};

export const STATUS_CONFIG = {
  idle: { label: "Queued", bg: "var(--surface)", border: "var(--border-mid)", text: "var(--muted)", dot: "var(--faint)" },
  running: { label: "Running", bg: "var(--run-light)", border: "var(--run-border)", text: "var(--accent)", dot: "var(--accent)" },
  pass: { label: "Pass", bg: "var(--pass-light)", border: "var(--pass-border)", text: "var(--pass)", dot: "var(--pass)" },
  fail: { label: "Fail", bg: "var(--fail-light)", border: "var(--fail-border)", text: "var(--fail)", dot: "var(--fail)" },
  manual: { label: "Manual", bg: "var(--warn-light)", border: "var(--warn-border)", text: "var(--warn)", dot: "var(--warn)" },
  cancelled: { label: "Cancelled", bg: "rgba(128,128,128,0.08)", border: "var(--border)", text: "var(--muted)", dot: "var(--faint)" },
};

export const SECTION_HEADERS = [
  "WHAT IS BEING TESTED",
  "API RESULTS",
  "CODE ANALYSIS",
  "ERROR LOCATION",
  "RECOMMENDATIONS",
];

export const DASHBOARD_ENDPOINTS = [
  {
    label: "Backend server",
    description: "Powers the QA tool itself",
    method: "GET",
    path: "/health",
  },
  {
    label: "User accounts",
    description: "Sign-in and registered users",
    method: "GET",
    path: "/accounts",
  },
  {
    label: "Test runner",
    description: "Receives Run Test requests",
    method: "POST",
    path: "/run-test",
    okStatuses: [200, 400],
  },
];

export const INTEGRATIONS = [
  {
    key: "openai",
    label: "OpenAI",
    blurb: "Reads your plain-English request and writes the test summary.",
  },
  {
    key: "websiteQa",
    label: "Website QA",
    blurb: "Runs local Playwright browser checks and returns pass/fail.",
  },
  {
    key: "jira",
    label: "Jira",
    blurb: "Loads ticket details when you paste a Jira link or key.",
  },
  {
    key: "slack",
    label: "Slack",
    blurb: "Sends pass/fail notifications when enabled in Settings.",
  },
  {
    key: "zohoCliq",
    label: "Zoho Cliq",
    blurb: "Sends pass/fail notifications when enabled in Settings.",
  },
];

export const defaultSettings = {
  backendUrl: CONFIG_DEFAULTS.backendUrl,
  soundOnComplete: false,
  exportFormat: "txt",
  displayName: "",
  theme: "dark",
  slackOnFail: false,
  slackOnPass: false,
  zohoCliqOnFail: false,
  zohoCliqOnPass: false,
};
