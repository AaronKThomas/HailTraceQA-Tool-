# HailTrace QA

Internal QA tool for the HailTrace team. Testers describe a feature in plain English or paste a Jira ticket, click **Run Test**, and get a structured verdict with recommendations and an execution log.

The React UI talks to a local Node backend (`server.js`). All API keys live in `.env` on the server — never in the browser.

## How it works

### End-to-end flow

When you click **Run Test**, the backend runs a pipeline. What runs depends on which credentials are in `.env` (see [Runtime modes](#runtime-modes)).

**Full pipeline** (OpenAI + HailTrace + Jira as needed):

```text
┌─────────────────────────────────────────────────────────────────┐
│  You enter plain English and/or a Jira URL or key (one/line)    │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Jira (optional)                                             │
│     If the line is HT-108 or a Jira URL, fetch summary,         │
│     description, and acceptance criteria from Jira API.         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. ChatGPT (OpenAI) — interpret                                │
│     Turn the request into a precise execution brief: what to    │
│     test, steps, expected outcomes, AC coverage.                │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. HailTrace API — execute                                     │
│     Run automated QA (API checks, browser/Playwright, etc.).      │
│     Returns pass / fail / needs manual check.                   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. ChatGPT — summarize                                         │
│     Explain results, where code needs work, and next steps.       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  UI shows sections + Execution Log + Live API call cards        │
└─────────────────────────────────────────────────────────────────┘
```

**Important:** ChatGPT does not replace HailTrace execution. It interprets your words and summarizes HailTrace’s results. The **verdict** comes from HailTrace when that integration is live.

### What you can paste

| Input | Example |
| ----- | ------- |
| Plain English | `User can submit a hail damage report and see it on the map` |
| Jira key | `HT-108` |
| Browse URL | `https://yourcompany.atlassian.net/browse/HT-108` |
| Board URL | `…/board?selectedIssue=HT-108` |

Multiple lines = multiple tests run **in order**.

The UI shows **Jira ticket detected** when a line looks like Jira. Fetched tickets appear with a **Jira** badge and the issue key on the test card.

### What you see after a run

Expand a test with **View**:

| Section | Meaning |
| ------- | ------- |
| **WHAT IS BEING TESTED** | Scope (includes `[HT-108]` when from Jira) |
| **API RESULTS** | Summary of HailTrace / integration calls |
| **CODE ANALYSIS** | Explanation of the outcome |
| **ERROR LOCATION** | Where work is needed (files, routes, UI) if applicable |
| **RECOMMENDATIONS** | Numbered actions — each has a **title** and **description** |
| **Live API Calls** | Cards for OpenAI, HailTrace, etc. (status, endpoint) |
| **Execution Log** | Narrative summary, timings, raw HailTrace log |
| **Verdict** | `PASS`, `FAIL`, or `NEEDS MANUAL CHECK` (badge on the card) |

History, templates, suites, and settings are stored in the browser (`localStorage`). Slack notifications fire from the backend when enabled in settings.

## Runtime modes

Check what is active:

```bash
curl http://localhost:3001/health
```

Each integration is `"live"` or `"demo"`:

| Credentials set | Behavior on **Run Test** |
| --------------- | ------------------------ |
| OpenAI + HailTrace | Full pipeline (interpret → execute → summarize) |
| OpenAI only | ChatGPT plan + execution brief; verdict **NEEDS MANUAL CHECK**; no HailTrace run |
| HailTrace only | Direct HailTrace call (no ChatGPT) |
| Jira only | Real ticket text when input is a Jira URL/key |
| None | Demo mode: keyword-based mock verdicts |

Partial config (e.g. only `JIRA_BASE_URL` without email/token) logs a warning at server start and stays on demo for that service.

## Setup

### 1. Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env` with your keys (see table below), then restart the backend whenever you change it.

### 2. Run locally (two terminals)

**Terminal 1 — backend**

```bash
npm run server
```

**Terminal 2 — frontend**

```bash
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`). The app expects the backend at `http://localhost:3001` unless you change it in Settings.

### 3. Production build

```bash
npm run build
npm run preview
```

Serve `dist/` behind your host; run `server.js` separately with the same `.env`.

## Environment variables

All secrets go in the project root `.env` file (gitignored). Copy from `.env.example`.

| Variable | Purpose |
| -------- | ------- |
| `PORT` | Backend port (default `3001`) |
| `OPENAI_API_KEY` | ChatGPT — interpret input and summarize results |
| `OPENAI_MODEL` | Optional model (default `gpt-4o-mini`) |
| `HAILTRACE_API_BASE_URL` | HailTrace API host |
| `HAILTRACE_API_KEY` | HailTrace auth |
| `HAILTRACE_QA_PATH` | Run-test path (default `/qa/run-test`) |
| `HAILTRACE_AUTH_STYLE` | `bearer` or `api-key` |
| `JIRA_BASE_URL` | e.g. `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | Atlassian account email |
| `JIRA_API_TOKEN` | [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `SLACK_WEBHOOK_URL` | Incoming webhook for pass/fail notifications |

## Stack

- **Frontend:** React 18, Vite, `localStorage`
- **Backend:** Express (`server.js`), integrations in `server/`

## Project structure

```text
HailTraceQATool/
├── server.js                 # HTTP API, auth, /run-test orchestration
├── server/
│   ├── integrations.mjs      # HailTrace API, Jira, Slack
│   ├── openai.mjs            # ChatGPT plan + summarize
│   ├── jiraKey.mjs           # Parse Jira URLs/keys
│   └── loadEnv.mjs
├── src/
│   ├── App.jsx               # Shell and tab routing
│   ├── hooks/                # useTests, useAuth, useSuites, …
│   ├── components/tabs/      # Tests, History, Settings, …
│   └── lib/                  # API client, constants, utils
├── styles.css
├── .env.example
└── data/accounts.json        # Local registered users (created at runtime)
```

## API endpoints

The frontend calls these on the backend:

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/health` | Service status and live/demo per integration |
| `POST` | `/login` | Sign in |
| `POST` | `/register` | Create account |
| `GET` | `/accounts` | List users (sanitized) |
| `DELETE` | `/accounts/:username` | Remove user |
| `POST` | `/run-test` | Run QA pipeline (`description`, optional `jiraKey`) |
| `GET` | `/jira/issue/:key` | Fetch ticket for the UI |
| `POST` | `/notifications/slack` | Send result notification |
| `POST` | `/notifications/slack/test` | Test webhook |

## Architecture notes

- **`useTests`** — Parses input, loads Jira in the browser, calls `/run-test`, updates cards and history.
- **`POST /run-test`** — Resolves Jira if needed (`resolveTestInput`), then OpenAI and/or HailTrace per [runtime modes](#runtime-modes).
- **Demo fallbacks** in `server.js` keep the UI usable without real credentials.
- **`App.jsx`** is the composition root; tab logic lives in hooks and `src/components/tabs/`.

For integration details, see `server/integrations.mjs` and `server/openai.mjs`.
