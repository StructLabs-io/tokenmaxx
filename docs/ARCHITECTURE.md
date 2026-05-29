# Architecture

**Version:** v0.1
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | Human Approved | Initial public architecture overview |

---

## System overview

```
Your machine(s)           Supabase (your project)          Cloudflare Pages
──────────────────        ────────────────────────         ─────────────────
local-capture.js  ──────► usage_events                     Next.js dashboard
server-capture.js ──────► toggl_entries                    ├── / (overview)
                          projects                          ├── /usage
                          quota_observations ◄──────────── ├── /projects
                          pricing_snapshots                 └── /raw
                          fx_rates
                               │
                               │ Telegram Bot API
                               ▼
                          Your Telegram (daily digest)
```

---

## Components

### 1. Capture scripts (your machine)

Node.js scripts that run via cron on any machine where you use AI tools.

- Read local JSONL logs written by Claude Code and Codex CLI
- Parse per-session, per-model token counts
- POST batched rows to your Supabase project via the service-role key

The public repo ships these scripts. You run them on your own hardware.

### 2. Supabase project (your database)

A standard Supabase project (free tier workable for solo use; Pro recommended for daily use and backups).

**What lives here:**

- `usage_events` — one row per (session, model) tuple with token counts and computed cost
- `projects` — your projects, synced from Toggl or created manually
- `toggl_entries` — time entries pulled from Toggl API hourly (if you use Toggl)
- `quota_observations` — snapshot of your subscription quota % at a point in time
- `pricing_snapshots` — per-model pricing pulled from OpenRouter daily
- `fx_rates` — USD → MYR/SGD rates for local-currency cost display
- Edge Functions for background jobs (Toggl sync, pricing pull, FX rate, Telegram digest)

RLS (Row Level Security) is enabled on all workspace-scoped tables. Your data is isolated within your project.

### 3. Cloudflare Pages (your dashboard)

A Next.js 15 app deployed to Cloudflare Pages. Connects directly to your Supabase project via the anon key + user JWT.

Pages at v0.1:
- `/` — daily overview: tokens, cost, top projects
- `/usage` — detailed per-model usage over time
- `/projects` — project attribution breakdown
- `/raw` — live feed of recent events (uses Supabase Realtime)

### 4. Telegram digest

A Supabase Edge Function runs daily and POSTs a summary to your Telegram bot. No separate bot server.

---

## Data model summary

### Core tables

| Table | Purpose |
|---|---|
| `workspaces` | Tenant unit. Each self-hoster runs one workspace. |
| `users` | Human users and service accounts (e.g. your server's cron identity). |
| `usage_events` | One row per (session, model) — the core data. |
| `projects` | Your projects. Attribution target. |
| `toggl_entries` | Toggl time entries, used to attribute usage events to projects. |
| `subscriptions` | Your AI subscriptions (Claude Max, Codex Pro, etc.). |
| `quota_windows` | Window definitions (5h rolling, weekly) per subscription. |
| `quota_observations` | Snapshots of quota % at a point in time. |
| `pricing_snapshots` | Per-model token prices, delta-tracked over time. |
| `fx_rates` | Daily USD exchange rates. |
| `attribution_overrides` | Manual project assignments when automatic attribution can't resolve. |

See [DATA-MODEL.md](DATA-MODEL.md) for the simplified schema overview.

---

## Multi-tenant model

Each user or team runs their own Supabase project. Multiple users within a team share one project, isolated via workspace membership and RLS.

There is no shared Tokenmaxx database. Your data never leaves your Supabase project.

---

## Security model

- **Service-role key:** Used by capture scripts and Edge Functions. Never exposed to the browser. Lives in machine-local env files.
- **Anon key + JWT:** Used by the Next.js frontend in the browser. RLS enforces per-user, per-workspace access.
- **No credential storage:** Quota capture uses session cookies you supply manually. No passwords are stored.

---

## Known constraints (Cloudflare Pages + Next.js adapter)

The frontend uses the `@cloudflare/next-on-pages` adapter. Trade-offs:

- **Edge Runtime only** — no Node.js middleware in route handlers
- **ISR limited** — use `cache: 'no-store'` for dynamic pages
- **Streaming RSC** — some Suspense patterns may need fallback to client-side loading

These are accepted constraints for MVP. See the roadmap for the v1.0 revisit gate.
