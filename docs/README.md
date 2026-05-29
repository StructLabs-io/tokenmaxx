# Tokenmaxx

**Version:** v0.1
**Status:** Draft — pending Ben's review
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | An AI agent | Initial public README |

---

Track what your AI subscriptions actually cost — by project, by model, by day.

---

## What it does

Tokenmaxx captures token usage from Claude Code, Codex CLI, and other AI developer tools, stores it in your own Supabase database, and gives you a dashboard that answers:

- How much did I spend on AI this week, broken down by project?
- Which model (Opus, Sonnet, Haiku) is eating most of my budget?
- Am I about to hit my Claude Max 5-hour or weekly quota window?
- What did this client engagement cost in AI tokens?

It runs against **your** Supabase project. Your data stays yours. No SaaS account required.

---

## Who it is for

Developers and teams who:

- Use Claude Code, Codex CLI, or similar AI developer tools regularly
- Want project-level cost attribution (how much did the ACME client cost in AI tokens?)
- Track time in Toggl and want to join AI usage against time entries
- Have a Claude Max or Codex Pro subscription and want to see headroom before they hit the 5-hour window

---

## How it works

```
Your machine (cron)
  │  reads local JSONL logs from Claude Code / Codex CLI
  │
  ▼
Supabase Postgres
  │  one row per (session, model) — exact cost attribution
  │  project assignment via Toggl time-entry overlap
  │
  ▼
Cloudflare Pages (Next.js)
  │  dashboard: daily usage, per-project breakdown, raw feed, quota view
  │
  ▼
Telegram
     daily digest: yesterday's spend, top projects, quota status
```

---

## Feature overview

| Feature | v0.1 (MVP) | v1.0 |
|---|---|---|
| Claude Code usage capture | Yes | Yes |
| Codex CLI usage capture | Yes | Yes |
| Per-model cost breakdown (Opus vs Haiku vs Sonnet) | Yes | Yes |
| Toggl-based project attribution | Yes | Yes |
| Daily Telegram digest | Yes | Yes |
| Dashboard (4 pages) | Yes | Yes |
| Quota % headroom (5h / weekly windows) | Manual entry only | Automated from your subscription dashboard |
| Team / multi-user | Schema-ready | UI available |
| Rule-based quota alerts | No | Yes |
| Year-in-review view | No | Yes |
| Self-hosted public deploy | Docs only | Full deploy from this repo |

---

## Stack

- **Database + auth + background jobs:** Supabase (Postgres, Edge Functions, pg_cron, Realtime)
- **Frontend:** Next.js 15 + shadcn/ui, deployed to Cloudflare Pages
- **Capture scripts:** Node.js, run via cron on your machine and any servers
- **Time tracking integration:** Toggl API (optional, for project attribution)

---

## Self-hosting

Tokenmaxx is designed to be self-hosted. Each user or team runs their own Supabase project. There is no hosted SaaS version.

See [SETUP-HUMAN.md](SETUP-HUMAN.md) for what you need to do yourself, and [SETUP-AGENT.md](SETUP-AGENT.md) for what your AI agent can do once you've completed the prerequisites.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
