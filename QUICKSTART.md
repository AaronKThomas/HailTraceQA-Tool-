# Quickstart

This is the fastest path for another developer to run the project locally and verify the main flows.

## What this app is

- React frontend (`vite`)
- Local Node/Express backend (`server.js`)
- Optional integrations: OpenAI, HailTrace, Jira, Slack, Zoho Cliq
- Works in demo mode locally when integrations are not configured

## Prerequisites

- Node.js 18+ recommended
- npm
- A project-root `.env` file

## 1. Install dependencies

```bash
npm install
```

## 2. Create your local env file

Start from the example:

```bash
cp .env.example .env
```

Minimum local values:

```env
PORT=3001
ALLOW_DEMO_MODE=true
```

For internal production-style testing, also set:

```env
NODE_ENV=production
SESSION_SECRET=replace_with_a_long_random_secret
CORS_ALLOWED_ORIGINS=http://localhost:5173
ALLOW_DEMO_MODE=false
```

Generate a strong session secret with:

```bash
openssl rand -base64 48
```

## 3. Start the backend

```bash
npm run server
```

Expected behavior:

- backend listens on `http://localhost:3001`
- if legacy account data exists with no admin role, the first account is auto-promoted to admin on startup

## 4. Start the frontend

In a second terminal:

```bash
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

## 5. Recommended validation steps

Run these before sharing or deploying:

```bash
npm test
npm run build
npm run check:prod
npm run checklist
```

## 6. First-use smoke test

Verify these flows:

1. Sign in or register.
2. Run one manual test prompt.
3. If configured, paste a Jira ticket key or Jira URL.
4. If you are an admin, verify user management in Settings.
5. Test sign out and sign back in.

## 7. Common local modes

### Demo mode

Use this when you want to test the UI without real integrations:

```env
ALLOW_DEMO_MODE=true
```

### Live integrations

Fill in the relevant keys in `.env`:

- `OPENAI_API_KEY`
- `HAILTRACE_API_BASE_URL`
- `HAILTRACE_API_KEY`
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `SLACK_WEBHOOK_URL`
- `ZOHO_CLIQ_WEBHOOK_URL`

## Notes for developers

- Accounts are stored locally in `data/accounts.json`.
- Session auth is cookie-based and enforced by the backend.
- The frontend should point at `http://localhost:3001` unless you intentionally change the backend URL in Settings.
- This is an internal tool, not a customer-facing multitenant system.
