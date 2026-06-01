# TokenMaxx

Track what your AI subscriptions actually cost — by project, by model, by day.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is this?

TokenMaxx captures token usage from Claude Code and Codex CLI, stores it in your own Supabase database, and gives you a dashboard that breaks down AI spend by project, model, and day. Your data stays in your own Supabase project — no SaaS account required.

**Status: v1.0, live.** The dashboard is deployed at [tokenmaxx.structlabs.io](https://tokenmaxx.structlabs.io) with Supabase auth, live usage data, subscription tracking, and automated quota capture via Brave browser session cookies.

---

## Getting started

There are two ways to set up TokenMaxx, depending on what you want.

### Try it locally

For evaluating TokenMaxx, contributing, or playing with the dashboard. Runs entirely on your laptop with a local Postgres. No Supabase or Cloudflare account needed.

[docs/SETUP-LOCAL-DEV.md](docs/SETUP-LOCAL-DEV.md)

### Deploy it for real

For tracking your actual AI subscription usage day-to-day. Uses real Supabase + Cloudflare; the dashboard lives at a URL you can bookmark.

Most of the setup is automated by your AI agent. You only need to do a few one-time manual things:

1. [Sign up for accounts and paste secrets into `.env.local`](docs/SETUP-HUMAN.md) (~5 min)
2. Then tell your AI agent: "set up TokenMaxx per `docs/SETUP-AGENT.md`"

Humans start here: [docs/SETUP-HUMAN.md](docs/SETUP-HUMAN.md)

Agents read this: [docs/SETUP-AGENT.md](docs/SETUP-AGENT.md)

---

## Architecture, data model, roadmap

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview and component breakdown |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | Database schema (simplified) |
| [docs/CAPTURE-PIPELINES.md](docs/CAPTURE-PIPELINES.md) | How usage data flows from your machine into Supabase |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's planned beyond v0.1 |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
