# Roadmap

**Version:** v0.1
**Status:** Draft — pending Ben's review
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | An AI agent | Initial public roadmap |

---

## What's in the current release (v0.1 MVP)

- Claude Code + Codex CLI usage capture via cron scripts
- Per-model cost attribution (one row per session × model)
- Toggl time-entry based project attribution
- Daily Telegram digest
- Next.js dashboard on Cloudflare Pages (4 pages: overview, usage, projects, raw feed)
- Supabase Realtime live feed on raw feed page
- Agentic manual tagging: when automatic attribution fails, your AI agent presents discrepancies for you to resolve via chat
- Historical backfill from JSONL logs
- Schema supports teams (workspaces, roles, multiple users) — UI comes in v0.2+

---

## Coming next (v0.2–0.5)

- **Auth UI** — sign in with email or GitHub via Supabase Auth; invite teammates
- **Subscriptions UI** — list your AI subscriptions, link users, see cost vs. utilisation
- **Project management UI** — create and edit projects without touching SQL
- **Re-attribution** — re-assign past usage events to a different project through the dashboard

---

## v1.0

- **Quota capture** — automated fetching of quota % used from your subscription dashboards (5h and weekly windows)
- **Rule-based alerts** — get a Telegram alert when you hit 80% of your 5h window
- **Year-in-review** — shareable summary of your AI usage for the year
- **Reconciler UI** — web interface for resolving unattributed events (click-to-assign, replaces the agentic chat flow for users who prefer a UI)
- **Public deploy** — full deploy guide tested on a clean machine

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
