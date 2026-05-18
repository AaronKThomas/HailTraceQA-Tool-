# HailTrace QA

React-based internal QA tool for the HailTrace team. Testers describe features in plain English or paste Jira tickets, and the tool sends those requests to the QA backend for analysis and verdicts.

## Stack

- React 18
- Vite
- Local browser persistence via `localStorage`
- Backend expected at `http://localhost:3001` by default

## Project Structure

```text
hailtrace-qa/
├── index.html
├── package.json
├── package-lock.json
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── components/
│   └── lib/
└── styles.css          # visual system reused by the React app
```

## Frontend Setup

1. Install dependencies:

```bash
npm install
```

2. Optional: create a local env file for backend secrets later:

```bash
cp .env.example .env
```

3. Start the dev server:

```bash
npm run dev
```

4. Start the local mock backend:

```bash
npm run server
```

5. Build for production:

```bash
npm run build
```

## Backend Expectations

The frontend expects a backend with these endpoints:

- `GET /health`
- `POST /login`
- `POST /register`
- `GET /accounts`
- `DELETE /accounts/:username`
- `POST /run-test`
- `GET /jira/issue/:key`
- `POST /notifications/slack`
- `POST /notifications/slack/test`

This repo now includes a minimal `server.js` mock backend for local preview and UI development. It stores registered accounts in `data/accounts.json` and returns simulated QA, Jira, and Slack responses.

## Environment Variables

Backend configuration lives in a root `.env` file (never in the frontend). Copy `.env.example` to `.env`, add your keys, and restart `npm run server`.

| Variable | Turns on |
|----------|----------|
| `HAILTRACE_API_BASE_URL` + `HAILTRACE_API_KEY` | Live QA via HailTrace API |
| `HAILTRACE_QA_PATH` | API path (default `/qa/run-test`) |
| `HAILTRACE_AUTH_STYLE` | `bearer` or `api-key` |
| `JIRA_BASE_URL` + `JIRA_EMAIL` + `JIRA_API_TOKEN` | Live Jira ticket fetch |
| `SLACK_WEBHOOK_URL` | Live Slack notifications |

Check mode at `GET http://localhost:3001/health` — each integration reports `live` or `demo`.

Integration code: [`server/integrations.mjs`](server/integrations.mjs). Demo fallbacks remain in [`server.js`](server.js) when credentials are missing.

## Current Notes

- Per-user history, settings, templates, and suites now persist via `localStorage`
- The old one-file DOM app has been replaced by a React app under `src/`
- Jira access and Slack delivery are now expected to be configured on the backend
- HailTrace API credentials are also expected to be configured on the backend
- The suite scheduler UI currently supports `Off` and `On Login`
- Without `.env` credentials the backend runs in **demo** mode; with keys it calls the real services automatically

## Reviewer Notes

- `App.jsx` is intentionally the composition root only. The heavier behavior lives in `useAuth`, `useTests`, `useSuites`, and `useAccounts`.
- `server.js` is intentionally a contract-preserving mock so the UI can be reviewed without live third-party credentials.
- The next production-facing steps are straightforward: replace file-backed auth, implement real HailTrace/Jira/Slack service layers behind the backend routes, and add focused lint/tests around hooks and route contracts.
