# Capture Pipelines

**Version:** v0.1
**Status:** Draft — pending Ben's review
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | An AI agent | Initial public capture pipelines overview |

---

How your AI usage data gets from your machine into Tokenmaxx.

---

## Overview

```
Source                        How it's captured          When
────────────────────────────  ─────────────────────────  ───────────────
Claude Code JSONL (laptop)    local-capture.js           cron, daily
Codex CLI sessions (laptop)   local-capture.js           cron, daily
Claude Code JSONL (server)    server-capture.js          cron, daily
Codex CLI sessions (server)   server-capture.js          cron, daily
Toggl time entries            Edge Function: toggl-sync  hourly
Pricing data (OpenRouter)     Edge Function: pricing-pull daily
FX rates                      Edge Function: fx-rate     daily
Quota % (v1.0)                quota-fetch.js             every 15 min
```

---

## 1. Local usage capture (your machine)

**Script:** `scripts/local-capture.js`
**Reads from:** JSONL files that Claude Code and Codex CLI write locally on your machine

Claude Code writes detailed session logs to `~/.claude/projects/`. Codex CLI writes session logs to `~/.codex/sessions/YYYY/MM/DD/`. The capture script reads these, parses token counts, and POSTs the data to your Supabase project.

### Per-model split

A single Claude Code session can use multiple models (for example, Opus for a planning step and Haiku for routine edits). Tokenmaxx tracks these separately — **one database row per (session, model)** — because cost varies significantly by model.

The rule:
- Each model that represents ≥1% of a session's total tokens gets its own row
- Models with <1% token share are folded into the dominant model's row to prevent row explosion

This means a session that split 60/40 between Opus and Haiku produces two rows with accurate cost attribution for each model.

### Incremental sync

The script maintains a state file at `~/.config/tokenmaxx/local-state.json` that records the last successfully synced date per source. Re-runs are safe — the dedup constraint on the database prevents duplicate rows.

---

## 2. Server usage capture

**Script:** `scripts/server-capture.js`

Same logic as local capture, but designed to run on a server (VPS, cloud instance) where AI tools run in automated or agent contexts. Configure a separate user slug for each machine.

---

## 3. Toggl integration (project attribution)

If you track your time in Toggl, Tokenmaxx can automatically attribute AI usage to the project you were working on when the usage occurred.

**How it works:**
1. An Edge Function pulls your Toggl time entries hourly
2. When a usage event's timestamp falls within a Toggl entry's time window, it's assigned that entry's project
3. If multiple Toggl entries overlap (rare), the longest-running one wins
4. If no Toggl entry covers the event, it goes to the "unattributed" bucket

You can manually assign projects to unattributed events later — via your AI agent (agentic tagging) or, at v1.0, via a UI.

**Configuring Toggl:** Add `TOGGL_API_TOKEN` to your `.env` file. Your Toggl API token is in your Toggl profile settings.

---

## 4. Pricing and FX data

Two Edge Functions run daily to keep cost calculations current:

- **`pricing-pull`** — fetches current per-model token prices from OpenRouter's model list and records any changes as new pricing snapshot rows. Historic cost calculations are not retroactively altered.
- **`fx-rate`** — fetches USD → MYR and USD → SGD exchange rates so costs can be displayed in your local currency.

These run automatically once pg_cron is configured. No action required after initial setup.

---

## 5. Quota capture (v1.0)

Anthropic and OpenAI do not publish quota cap numbers for Claude Max / Codex Pro subscriptions. The only source for "X% used" data is your subscription dashboard.

At v1.0, Tokenmaxx provides a script (`scripts/quota-fetch.js`) that calls the internal API your subscription dashboard uses — the same approach used by popular desktop quota-tracking apps. It requires a session cookie from your authenticated browser session (you supply this once; no password is stored).

At v0.1 (MVP), you can enter quota observations manually via SQL, or use the widget-data.json file written by compatible desktop quota apps if you run one.

---

## 6. What is NOT captured by default

- **API calls you make directly** to Anthropic/OpenAI in your own applications — these require custom instrumentation (v2.0 webhook ingest, or manual logging)
- **IDE integrations** like Cursor or GitHub Copilot — these don't write local JSONL logs accessible to Tokenmaxx (v2.0 target)
- **Quota reset times or token caps** — these come from `quota_observations`, which requires the v1.0 quota capture or manual entry

---

## 7. `capture_method` identifier

Every row in `usage_events` carries a `capture_method` string that describes exactly how it was captured. The format is:

```
<provider>.<tool>.<surface>.<context>
```

Examples:
- `anthropic.claude_code.cli.personal_dev` — Claude Code on your personal machine
- `openai-codex.codex.cli.server_automation` — Codex CLI on a server

This lets you filter and attribute costs by tool and context in the dashboard.
