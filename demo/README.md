# Tokenmaxx — Public Demo

This directory contains a self-contained demo deployment of Tokenmaxx
that ships with **fictional** usage data structured to look like a real
solo consultant/dev's dashboard. Used at
[tokenmaxx-demo.structlabs.io](https://tokenmaxx-demo.structlabs.io) (CF Pages).

## What's in here

| File | Purpose |
|---|---|
| `seed-demo-data.ts` | Generates 12 months × 8 clients × 25 projects worth of plausible usage events. Numbers vary by day-of-week + hour-of-day to simulate real work patterns. |
| `rolling-refresh.ts` | Cloudflare Worker scheduled job. Shifts the demo data window so the dashboard always looks "current" — yesterday's data exists, last week is populated, the 14-day chart isn't all blanks. Runs nightly at 00:30 UTC. |
| `fictional-names.ts` | Renzo-curated client + project names (no real-world identification). Categories: agency clients, internal projects, learning/research, personal. |
| `demo-mode-flag.ts` | Reads `NEXT_PUBLIC_TOKENMAXX_DEMO=1` and switches lib/data.ts to read from the in-memory seed instead of Supabase. |

## Architecture

```
                   Cloudflare Pages
                   tokenmaxx-demo.structlabs.io
                          ↑
                    git push to public repo
                          ↑
   StructLabs-io/tokenmaxx (public)
                          ↓
              /demo dir (this folder)
              ├── seed-demo-data.ts
              ├── rolling-refresh.ts (CF Worker cron)
              ├── fictional-names.ts
              └── demo-mode-flag.ts
```

The demo deploys from the public repo directly — no private fork, no real
data, no credentials. The Worker that refreshes the rolling window runs
on a free CF account separate from Ben's production setup.

## Fictional client / project structure

8 clients × ~3 projects each = 25 projects:

1. **Forge Atelier** (digital agency) — Q3 Campaign Kit, Onboarding Refresh, Brand Spike v2
2. **Vista Outdoors** (retail) — Inventory Sync, POS Integration, Catalog ETL
3. **Sandwich Robotics** (startup) — RAG Indexer, Voice Agent v0, MCP Server
4. **Heatherline Group** (HOA mgmt) — Pelham Estates, Birchwood, Twin Creeks (3 HOAs)
5. **Atomic Lawn Care** (small biz) — Scheduling Bot, Quote Generator
6. **Reed & Caswell PLLC** (legal) — Discovery Triage, Brief Drafter, Calendar Triage
7. **Studio Petalwave** (creative) — Brand Audit, Motion Sandbox, Voice Memo Pipeline
8. **Internal** (no client) — Marketing, Operations, Personal, Learning

## Local dev

```bash
cd ~/Projects/public/tokenmaxx
NEXT_PUBLIC_TOKENMAXX_DEMO=1 npm run dev
# Visit http://localhost:3000 — runs against demo data.
```

## Deployment

CF Pages auto-deploys on push to `main` (when wired). The Worker for
rolling-refresh deploys via `wrangler deploy demo/rolling-refresh.ts`.

## Why fictional + rolling

The demo needs to look credible to anyone who lands on it cold. Static
"as of 2026-01-15" data would clearly look frozen by week 2. Rolling
forward each night keeps the impression of an active workspace.
