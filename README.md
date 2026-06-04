# HailTrace QA

Internal QA workspace for the HailTrace team. Testers can paste plain-English scenarios or Jira tickets, run them through the local backend, and review a structured verdict, recommendations, and execution history.

This repo is a small full-stack app:

- React + Vite frontend in `src/`
- Express backend in [server.js](/Users/aaronthomas/Desktop/HailTraceQATool/server.js)
- File-backed local account store in `data/accounts.json` at runtime
- Optional integrations for OpenAI, Jira, Slack, Zoho Cliq, and Customer.io

## What Problem It Solves

The app gives QA a single internal workspace for:

- turning plain-English requests into a test brief
- optionally expanding Jira tickets into structured test context
- executing local Playwright website QA when a public URL is provided
- summarizing results for faster triage
- saving history, templates, suites, and exports per user

Without credentials, it still works in demo mode for local UI and workflow development.

## How It Works

At runtime, the backend chooses the best available pipeline based on environment configuration:

1. User enters a plain-English scenario, Jira key, or Jira URL.
2. The frontend detects Jira-like input and can fetch ticket details through the backend.
3. `POST /run-test` resolves the input into a test brief.
4. If OpenAI is configured, the backend uses it to interpret the request and summarize outcomes.
5. If a public website URL is present, the backend executes a local Playwright QA run.
6. The UI stores user-owned history, templates, suites, and settings in browser `localStorage`.

Runtime behavior by config:

- OpenAI + website URL: interpret -> Playwright execute -> summarize path
- website URL only: direct Playwright execution without LLM planning
- OpenAI only without a website URL: QA plan and analysis, no browser execution
- No external credentials: demo/mock behavior

Playwright can also execute constrained page actions such as clicking text,
clicking simple selectors, filling labeled fields, and checking that text or a
popup-like element appears. Authenticated target pages require a dedicated
low-privilege test account configured only on the backend.

## Main User Flows

- Sign in with a backend-issued `HttpOnly` session cookie
- Bootstrap the first account as admin
- Admin invites users or creates them directly
- Invited users accept a one-time link and set their own password
- Users request password-reset links
- Testers run scenarios, save templates, group tests into suites, and export results

## Security Model

The current design gets several important basics right:

- credentials stay server-side in `.env` or `.env.production`
- frontend calls the backend with cookie auth; it does not talk directly to Jira or OpenAI
- passwords are hashed server-side before storage
- session cookies are signed and `HttpOnly`
- invite and reset tokens are hashed at rest and time-limited
- auth, test execution, Jira, and notification paths are rate-limited
- production readiness checks fail closed on unsafe config

Relevant files:

- [server/security.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/server/security.mjs)
- [server/tokens.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/server/tokens.mjs)
- [scripts/check-production-readiness.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/scripts/check-production-readiness.mjs)
- [tests/security.test.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/tests/security.test.mjs)
- [tests/auth-flow.test.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/tests/auth-flow.test.mjs)

## Current Constraints

This project is still best treated as a single-instance internal tool.

- Accounts are stored in a local JSON file, not a database.
- Rate limits are in-memory per Node process.
- Concurrent writes to `data/accounts.json` are not coordinated across processes.
- History/templates/suites/settings are stored client-side per user in `localStorage`.

That means this is fine for local development and a small internal deployment, but not yet a horizontally scaled or highly concurrent production system.

## Project Structure

```text
HailTraceQATool/
├── src/
│   ├── App.jsx                    # App composition root and public auth routes
│   ├── components/                # Login, invite/reset flows, shell, tabs
│   ├── hooks/                     # Auth, tests, suites, accounts, export state
│   └── lib/                       # API client, storage, export helpers, constants
├── server.js                      # Express API, auth, orchestration, runtime modes
├── server/
│   ├── security.mjs               # Cookie auth, hashing, validation, rate limiting
│   ├── tokens.mjs                 # Invite/reset token generation and verification
│   ├── email.mjs                  # Customer.io-backed invite/reset delivery
│   ├── integrations.mjs           # Jira, Slack, Zoho Cliq calls
│   ├── openai.mjs                 # LLM-guided QA flows
│   ├── websiteQa.mjs              # Local Playwright website QA runner
│   ├── jiraKey.mjs                # Jira URL/key parsing helpers
│   └── loadEnv.mjs                # Dev/prod env loading
├── tests/                         # Node test coverage for security and auth flows
├── scripts/
│   ├── start-prod.mjs             # Safe local production launcher
│   ├── check-production-readiness.mjs
│   ├── internal-publish-checklist.mjs
│   └── migrate-accounts-to-email.mjs
├── QUICKSTART.md                  # Fastest path for other devs
├── .env.example
└── .env.production.example
```

## API Surface

Core backend routes:

- `GET /health`
- `GET /health/integrations`
- `POST /login`
- `POST /register`
- `POST /logout`
- `GET /session`
- `GET /accounts`
- `POST /invite`
- `GET /invite/:token`
- `POST /accept-invite`
- `POST /forgot-password`
- `GET /reset/:token`
- `POST /reset-password`
- `POST /run-test`
- `GET /jira/issue/:key`
- `POST /notifications/slack`
- `POST /notifications/zoho-cliq`

## Developer Start Here

Use [QUICKSTART.md](/Users/aaronthomas/Desktop/HailTraceQATool/QUICKSTART.md) for day-one setup.

Short version:

```bash
npm install
cp .env.example .env
npm run start:dev
npm run dev
```

Then open `http://localhost:5173`.

## Environment Model

The backend intentionally separates dev and production config:

- `.env`: local development defaults
- `.env.production`: production-only overrides

Do not set `NODE_ENV` inside either file. The production launcher sets it for the child process when needed.

Important variables:

- `PORT`
- `SESSION_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `ALLOW_DEMO_MODE`
- `APP_PUBLIC_URL`
- `OPENAI_API_KEY`
- `TARGET_SITE_DEFAULT_URL`
- `TARGET_SITE_LOGIN_URL`
- `TARGET_SITE_TEST_EMAIL`
- `TARGET_SITE_TEST_PASSWORD`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `CUSTOMERIO_APP_API_KEY`
- `CUSTOMERIO_INVITE_TEMPLATE_ID`
- `CUSTOMERIO_RESET_TEMPLATE_ID`

See [.env.example](/Users/aaronthomas/Desktop/HailTraceQATool/.env.example) and [.env.production.example](/Users/aaronthomas/Desktop/HailTraceQATool/.env.production.example).

## Scripts

- `npm run dev` starts the Vite frontend
- `npm run start:dev` starts the backend in dev mode
- `npm run start:prod` runs fail-closed prod checks, then starts the backend in prod mode
- `npm test` runs the Node test suite
- `npm run build` builds the frontend
- `npm run check:prod` validates production-critical config
- `npm run checklist` prints an internal publish checklist

## Review Findings

Two important engineering limits are still present:

1. [server.js](/Users/aaronthomas/Desktop/HailTraceQATool/server.js:124) and [server.js](/Users/aaronthomas/Desktop/HailTraceQATool/server.js:136) use plain file reads and writes for account state. Concurrent requests or multiple app instances can overwrite each other's changes because there is no file lock, transactional write, or database coordination.
2. [server/security.mjs](/Users/aaronthomas/Desktop/HailTraceQATool/server/security.mjs:168) keeps rate-limit counters in process memory. That is acceptable for local/internal use, but limits reset on restart and do not protect across multiple instances.

Those are not reasons to stop using the app locally. They are reasons to document the current deployment envelope honestly and avoid over-claiming production readiness.
