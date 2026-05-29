# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-05-29

Initial public scaffold for Tokenmaxx v0.1 MVP.

### Added

- Next.js 15 + React 19 + TypeScript scaffold with Tailwind v4 + shadcn/ui (new-york)
- Dark sidebar navigation layout
- 4 dashboard pages on seed data: `/` (overview), `/usage`, `/projects`, `/projects/[slug]`
- `/raw` page — live usage event feed (Supabase Realtime, inactive until Supabase provisioned)
- `/api/health` edge route
- Cloudflare Workers deploy via `@opennextjs/cloudflare` (replaces deprecated `@cloudflare/next-on-pages`)
- `wrangler.jsonc` — Workers config with `nodejs_compat` flag
- `.env.example` — env var template
- `lib/seed-data.ts` — 14 days of synthetic usage events, 5 projects, 3 users, 4 quota windows
- MIT license
- Root `README.md` — product overview, v0.1 feature list, setup links
- `docs/` — 7 public documentation files:
  - `docs/README.md` — full feature overview and setup entry point
  - `docs/ARCHITECTURE.md` — system components and data flow
  - `docs/DATA-MODEL.md` — database schema overview
  - `docs/CAPTURE-PIPELINES.md` — how AI usage data flows into Supabase
  - `docs/SETUP-HUMAN.md` — steps only the human can take
  - `docs/SETUP-AGENT.md` — steps an AI agent can perform once prerequisites are met
  - `docs/ROADMAP.md` — v0.1 through v2.0+ feature planning
- `CONTRIBUTING.md` — code style, PR process, migration conventions
- `.github/ISSUE_TEMPLATE/` — bug report and feature request templates
- `.github/PULL_REQUEST_TEMPLATE.md`

### Not in v0.1

- Supabase wiring (schema migrations, Edge Functions, pg_cron)
- Capture scripts (`scripts/local-capture.js`, `scripts/server-capture.js`)
- Auth / sign-in flow
- Multi-user UI
- Automated quota capture (manual entry only)
- Production deploy guide (docs only, not tested end-to-end)
