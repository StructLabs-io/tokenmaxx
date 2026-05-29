# Tokenmaxx

Track what your AI subscriptions actually cost — by project, by model, by day.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Status

**Early WIP.** The dashboard scaffold runs on seed data. Supabase wiring and capture scripts are the next step.

This is v0.1 — single-user, laptop-first, no auth, no production deploy guide yet.

---

## What it does

Tokenmaxx captures token usage from Claude Code and Codex CLI, stores it in your own Supabase database, and gives you a dashboard that answers:

- How much did I spend on AI this week, broken down by project?
- Which model (Opus, Sonnet, Haiku) is consuming most of my budget?
- What did each client project cost in AI tokens?
- How much of my Claude Max or Codex Pro subscription am I using?

Your data stays in your own Supabase project. No SaaS account required.

---

## How it works

```
Your machine (cron)
  reads local JSONL logs from Claude Code / Codex CLI

Supabase Postgres
  one row per (session, model) — exact cost attribution
  project assignment via Toggl time-entry overlap

Cloudflare Pages (Next.js)
  dashboard: daily usage, per-project breakdown, raw feed
```

---

## v0.1 features

- Claude Code + Codex CLI usage capture via local cron scripts
- Per-model cost attribution (one row per session × model)
- Toggl time-entry based project attribution
- Next.js dashboard deployed to Cloudflare Pages — 4 pages:
  - `/` — daily overview: tokens, cost, top projects
  - `/usage` — per-model usage over time
  - `/projects` — project attribution breakdown
  - `/raw` — live feed of recent events (Supabase Realtime)
- Auth is not wired — v0.1 is single-user, no sign-in flow
- Quota headroom requires manual entry at v0.1 (automated capture comes later)

---

## Stack

- **Database:** Supabase (Postgres, Edge Functions, pg_cron, Realtime)
- **Frontend:** Next.js 15 + shadcn/ui, deployed to Cloudflare Pages via `@opennextjs/cloudflare`
- **Capture:** Node.js scripts, run via cron on your machine
- **Time tracking:** Toggl API (optional — needed for project attribution)

---

## Getting started

```bash
npm install
npm run dev
```

The app renders seed data until Supabase is connected.

For full setup, start here:

1. [What you (the human) must do first](docs/SETUP-HUMAN.md) — account sign-ups, API keys, env files
2. [What your AI agent can do](docs/SETUP-AGENT.md) — schema migrations, capture config, deploy

---

## Documentation

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview and component breakdown |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Database schema (simplified) |
| [docs/CAPTURE-PIPELINES.md](docs/CAPTURE-PIPELINES.md) | How usage data flows from your machine into Supabase |
| [docs/SETUP-HUMAN.md](docs/SETUP-HUMAN.md) | Prerequisites you must complete yourself |
| [docs/SETUP-AGENT.md](docs/SETUP-AGENT.md) | Setup steps your AI agent can handle |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's planned beyond v0.1 |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
