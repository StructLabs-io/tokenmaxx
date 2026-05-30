# Changelog

All notable changes to this project will be documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2026-05-30

Approved by Human, 2026-05-30.

Auth, subscriptions, quota capture, users, project management UI, reconciliation, and year-in-review.

### Added

**v0.2 — Auth**
- Supabase Auth middleware with email sign-in / sign-out
- Server-side Supabase client using service-role key
- `/auth/login`, `/auth/logout`, `/auth/callback` routes

**v0.3 — Subscriptions + Quota**
- `/subscriptions` page — lists AI subscriptions with 30-day token/cost totals
- `/quota` page — quota windows (5h rolling, 7-day calendar) with progress bars and live `fillPct` from `quota_observations`
- `quota_windows` and `quota_observations` Supabase tables
- `scripts/quota-tier1.js` — scrapes quota % from browser-injected page data
- `scripts/quota-tier2.js` — calls claude.ai internal usage API using Brave browser session cookies + cycletls TLS spoofing to bypass Cloudflare; writes observations to `quota_observations`
- `scripts/brave-cookies.js` — reads cookies directly from Brave browser's on-disk SQLite DB (no browser must be open); uses macOS Keychain for decryption key
- `supabase/functions/evaluate-quota-rules/` — Edge Function that fires Telegram alerts at configurable thresholds (e.g. 80% of 5h window)

**v0.4 / v0.5 — Users + Project Management**
- `/users` page — team member usage breakdown with 30-day totals
- `/projects` add + edit UI — create and edit projects without SQL
- Per-model breakdown on project detail pages

**v1.0 — Wrap, Reconcile, live quota data**
- `/wrap` — year-in-review summary page
- `/reconcile` — attribution UI for resolving unattributed events (click-to-assign)
- Quota page reads live `fillPct` from `quota_observations` (latest `percent_used` per window via Supabase query)
- Token and cost values formatted with comma separators throughout the dashboard
- `scripts/quota-codex.js` — framework for Codex quota capture (Codex analytics endpoints identified; capture in progress)

### Changed

- Dashboard deployed to tokenmaxx.structlabs.io (Cloudflare Workers via `@opennextjs/cloudflare`)
- Dashboard pages now connect to live Supabase data; seed data no longer required for normal operation

---

## [0.1.0] — 2026-05-29

Approved by Human, 2026-05-29.

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
