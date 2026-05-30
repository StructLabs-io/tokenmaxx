# Roadmap

**Version:** v1.0
**Status:** Approved (v1.0)
**Last updated:** 2026-05-30

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v1.0 | 2026-05-30 | Human Approved | Updated to reflect shipped v0.2–v1.0 features |
| v0.1 | 2026-05-29 | Human Approved | Initial public roadmap |

---

## What's in the current release (v1.0)

- Claude Code + Codex CLI usage capture via cron scripts
- Per-model cost attribution (one row per session × model)
- Toggl time-entry based project attribution
- Daily Telegram digest
- Supabase Auth — email sign-in / sign-out, server-side session handling
- Next.js dashboard deployed on Cloudflare Workers (tokenmaxx.structlabs.io)
  - `/` — overview
  - `/usage` — per-model usage over time
  - `/projects` — project attribution breakdown with per-model detail
  - `/subscriptions` — AI subscriptions with 30-day token/cost totals
  - `/quota` — quota windows (5h rolling, 7-day calendar) with live progress bars
  - `/users` — team member usage breakdown
  - `/reconcile` — click-to-assign UI for resolving unattributed events
  - `/wrap` — year-in-review summary
  - `/raw` — live event feed (Supabase Realtime)
- Automated quota capture — `quota-tier2.js` reads claude.ai's internal usage API via Brave browser session cookies (no browser open required); `brave-cookies.js` decrypts cookies from disk using macOS Keychain
- Rule-based Telegram alerts when quota thresholds are crossed (configurable %)
- Project management UI — create and edit projects without SQL
- Supabase Realtime live feed on raw feed page
- Historical backfill from JSONL logs
- Schema supports teams (workspaces, roles, multiple users)

---

## Coming next

- **Codex quota capture** — `quota-codex.js` framework in place; analytics endpoints identified; full capture in progress
- **Public deploy guide** — full end-to-end deploy walkthrough tested on a clean machine
- **Toggl attribution improvements** — edge-case handling for overlapping entries

---

## v2.0+ (future)

- Multi-provider capture: Cursor, Aider, Continue, GitHub Copilot
- Webhook ingest for tools that don't write local logs
- Read API for third-party integrations
- Hosted SaaS option (business decision, not committed)

---

## What's not in scope

- Mobile app
- Slack integration (Telegram is the primary notification channel)
- Automated quota login (we use session cookies you supply; no password storage)

---

## Issues and feedback

Open an issue on GitHub. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
