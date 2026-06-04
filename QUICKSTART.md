# Quickstart

Fastest safe path for you to run the app, understand the auth bootstrap flow, and avoid the common local setup traps.

## Prerequisites

- Node.js 18+
- npm
- two terminal tabs

## 1. Install

```bash
npm install
```

## 2. Create local config

```bash
cp .env.example .env
```

Local development rules:

- Leave `NODE_ENV` unset in `.env`
- Keep `ALLOW_DEMO_MODE=true` unless you are explicitly testing a stricter setup
- Use the default frontend origin `http://localhost:5173`

Why: the backend falls back to localhost-safe CORS defaults in dev. If you force `NODE_ENV=production` in `.env`, you will break that behavior and usually end up with browser `Failed to fetch` errors.

## 3. Start the backend

```bash
npm run start:dev
```

Backend default:

- `http://localhost:3001`

## 4. Start the frontend

In a second terminal:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Important:

- If Vite jumps to `5174`, the backend CORS defaults will not match.
- Kill the stale frontend process and restart so Vite comes back on `5173`.

## 5. First login and admin bootstrap

The app stores accounts in `data/accounts.json`, created at runtime by the backend.

Bootstrap behavior:

- if no accounts exist, the first successful registration becomes `admin`
- after that, only an authenticated admin can create more users
- admins can either invite users by email or create them directly in Settings

## 6. Recommended smoke test

Run this once after booting the app:

1. Register the first admin account.
2. Sign out and sign back in.
3. Run a plain-English test prompt.
4. Paste a Jira key or URL if Jira credentials are configured.
5. Open Settings and verify admin-only user management is visible.
6. Trigger forgot-password and confirm the UX path works.

## 7. Demo mode vs live integrations

You can develop most of the UI without real credentials.

Demo mode:

- `ALLOW_DEMO_MODE=true`
- no real OpenAI/Jira requirement
- invite/reset email links fall back to backend-side demo behavior when Customer.io is not configured

Live mode in local dev:

- fill in the relevant keys in `.env`
- restart the backend after env changes

Most useful variables:

- `OPENAI_API_KEY`
- `TARGET_SITE_DEFAULT_URL`
- `TARGET_SITE_LOGIN_URL`
- `TARGET_SITE_TEST_EMAIL`
- `TARGET_SITE_TEST_PASSWORD`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `SLACK_WEBHOOK_URL`
- `ZOHO_CLIQ_WEBHOOK_URL`
- `CUSTOMERIO_APP_API_KEY`
- `CUSTOMERIO_INVITE_TEMPLATE_ID`
- `CUSTOMERIO_RESET_TEMPLATE_ID`
- `APP_PUBLIC_URL`

Use the target-site variables only with a dedicated low-privilege test account.
`TARGET_SITE_DEFAULT_URL` defaults to `https://app.hailtrace.com/maps`, so
short prompts like "search for a weather event" can run against HailTrace
without pasting the URL each time.
They let Playwright log into authenticated pages before running constrained
actions such as clicking a map and checking that a popup appears.

## 8. Useful checks

```bash
npm test
npm run build
npm run checklist
```

If you want to inspect runtime mode quickly:

```bash
curl http://localhost:3001/health
```

### Smoke test against a running backend

`npm run smoke` exercises the backend's safe endpoints end-to-end without
mutating account state:

```bash
npm run smoke
```

What it checks: `/health`, `/health/integrations`, `/session` (anonymous),
`/forgot-password` (constant-200 contract), and that bad credentials are
rejected with 401.

Optional flags:

- `SMOKE_BASE_URL=...` — point at a different backend (default
  `http://localhost:3001`).
- `SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=...` — also exercise
  `login -> /session -> logout` against an existing admin. Skipped silently
  if either is missing. Nothing is persisted.
- `SMOKE_REQUIRE_INTEGRATIONS=true` — promote unreachable third-party
  integrations (OpenAI, Jira) from informational to a hard
  failure. Useful for pre-deploy checks; noisy in dev where networks may be
  restricted.

Exit codes: `0` all required probes passed, `1` a required probe failed,
`2` the backend was not reachable at all.

## 9. Production-style local run

Use this only when validating production config behavior.

```bash
cp .env.production.example .env.production
```

Fill in real values, then run:

```bash
npm run start:prod
```

What this does:

1. Refuses to start without `.env.production`
2. Runs `npm run check:prod`
3. Starts the backend with `NODE_ENV=production` on the child process only

For the frontend:

```bash
npm run build
npm run preview
```

## 10. Operational limits to keep in mind

This project is not yet designed for multi-instance deployment.

- account data is stored in a local JSON file
- rate limits are in-memory per process
- concurrent writes are not coordinated across multiple Node instances

For day-to-day local development, that is fine. For a broader internal deployment, developers should treat this as a single-instance service until persistence and rate limiting move to shared infrastructure.

## Troubleshooting

`Failed to fetch` in the browser:

- confirm the backend is running on `3001`
- confirm Vite is running on `5173`
- confirm `NODE_ENV` is not set in `.env`
- confirm the frontend backend URL in Settings is still `http://localhost:3001`

`npm run start:prod` fails immediately:

- `.env.production` is missing
- required production env vars are still placeholders
- `ALLOW_DEMO_MODE` is still `true`
- no admin account exists in `data/accounts.json`

No invite or reset emails arrive:

- if Customer.io is not configured, expect demo-only behavior
- check backend logs first
- confirm `APP_PUBLIC_URL` matches the frontend origin users should open
