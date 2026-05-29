# Data Model

**Version:** v0.1
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | Human Approved | Initial public data model overview |

---

Simplified schema overview. Table names and purpose — not internals like RLS policies or constraint definitions.

---

## Core table map

```
workspaces ──── workspace_members ──── users
     │                                    │
     ├── subscriptions ─── subscription_members ─── users
     │        │
     │    quota_windows ─── quota_observations
     │
     ├── projects ──── toggl_entries ──── users
     │
     └── usage_events ─── projects
                      └── subscriptions
                      └── pricing_snapshots

pricing_snapshots  (global, not workspace-scoped)
fx_rates           (global, not workspace-scoped)
attribution_overrides  (workspace-scoped, manual project assignments)
```

---

## Tables

### `workspaces`
The tenant unit. For self-hosters, you'll typically have one workspace per person or team.

Key columns: `slug` (URL-safe name), `display_name`, `timezone` (for local-date bucketing).

---

### `users`
Humans and service accounts (e.g. an automated server running AI tools).

Key columns: `slug` (machine-readable name), `display_name`, `account_type` (`human` or `service`).

---

### `workspace_members`
Links users to workspaces with a role (`admin`, `member`, `viewer`).

---

### `subscriptions`
Your AI subscriptions (Claude Max, Codex Pro, Cursor Pro, etc.).

Key columns: `provider` (e.g. `anthropic`), `plan_name` (e.g. `Claude Max 5x`), `monthly_cost_usd`, `billing_cycle_anchor`.

---

### `subscription_members`
Which users share a subscription's seat.

---

### `projects`
Your projects. Attribution target for usage events.

Key columns: `slug`, `display_name`, `toggl_project_id` (links to Toggl for auto-attribution), `billable`, `client`.

---

### `toggl_entries`
Your Toggl time entries, pulled hourly. Source of truth for project attribution windows.

Key columns: `started_at`, `ended_at`, `project_id` (resolved to a `projects` row), `task_type_code`.

---

### `usage_events`

**The core table.** One row per (session, model) tuple.

Key columns:

| Column | What it is |
|---|---|
| `captured_at` | When the usage occurred (UTC) |
| `provider` | `anthropic`, `openai`, `openai-codex`, etc. |
| `model` | e.g. `claude-opus-4-7`, `claude-haiku-4-5` |
| `capture_method` | Four-part identifier for how it was captured |
| `session_id` | ID of the AI session this event came from |
| `input_tokens` | Input tokens used |
| `output_tokens` | Output tokens generated |
| `cache_creation_tokens` | Cache write tokens (Anthropic) |
| `cache_read_tokens` | Cache read tokens (Anthropic) |
| `cost_usd` | Computed cost in USD at time of capture |
| `token_share_pct` | This model's % share of the session's total tokens |
| `project_id` | Attributed project (nullable; set by attribution job) |

Why one row per (session, model): a session that uses 60% Opus + 40% Haiku has very different cost to a 100% Haiku session. Keeping them separate lets you see and attribute costs accurately.

---

### `quota_windows`
Window definitions per subscription (e.g. "5h rolling" or "weekly reset on Monday").

---

### `quota_observations`
Point-in-time snapshots of quota % used. Written by the v1.0 quota-fetch script or manually.

Key columns: `percent_used`, `percent_remaining`, `observed_at`, `observation_method`.

---

### `pricing_snapshots`
Per-model token prices, delta-tracked. A new row appears when a price changes. Historic cost calculations use the snapshot active at the time of the event.

---

### `fx_rates`
Daily USD exchange rates (MYR, SGD). One row per date.

---

### `attribution_overrides`
Manual project assignments. Written by your AI agent (or at v1.0, via the `/reconcile` UI) when automatic Toggl-based attribution can't resolve a project.

Key columns: `session_id`, `model`, `override_project_id`, `override_reason`, `applied_by_agent`.

---

## Dedup key

The database prevents duplicate rows via a unique constraint on `usage_events`:

```
unique (user_id, capture_method, session_id, model, date_utc)
```

The `model` column is intentionally part of the key — it allows multiple rows per session when multiple models were used. Re-running capture scripts is always safe.

---

## Views

| View | What it shows |
|---|---|
| `vw_usage_with_cost` | Usage events joined with pricing and FX data — cost in USD/MYR/SGD |
| `vw_workspace_daily` | Daily rollup: tokens and cost by user, project, model |
| `vw_quota_window_state` | Current quota usage vs. cap per window |
| `vw_unattributed_events` | Events with no project assignment — candidates for manual tagging |
