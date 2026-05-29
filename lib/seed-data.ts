/**
 * MVP placeholder seed data.
 * Replace once Supabase is wired -- see lib/supabase/client.ts.
 *
 * All data is generic/fictional. No real user names, projects, or costs.
 *
 * Shapes match the real schema types from lib/supabase/types.ts.
 */

import type { UsageEvent, Project, User, QuotaWindow } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Users (2 fake humans + 1 service account)
// ---------------------------------------------------------------------------

export const SEED_USERS: User[] = [
  {
    id: "user-alice",
    auth_user_id: null,
    slug: "alice",
    display_name: "Alice",
    account_type: "human",
    email: "alice@example.com",
    default_timezone: "UTC",
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "user-bob",
    auth_user_id: null,
    slug: "bob",
    display_name: "Bob",
    account_type: "human",
    email: "bob@example.com",
    default_timezone: "UTC",
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "user-svc",
    auth_user_id: null,
    slug: "demo-server",
    display_name: "demo-server",
    account_type: "service",
    email: null,
    default_timezone: "UTC",
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
  },
];

// ---------------------------------------------------------------------------
// Projects (5 fake projects)
// ---------------------------------------------------------------------------

export const SEED_PROJECTS: Project[] = [
  {
    id: "proj-alpha",
    workspace_id: "ws-demo",
    slug: "alpha",
    display_name: "Project Alpha",
    client: null,
    toggl_project_id: 10001,
    billable: true,
    active: true,
    notes: null,
    created_at: "2025-01-05T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "proj-beta",
    workspace_id: "ws-demo",
    slug: "beta",
    display_name: "Project Beta",
    client: null,
    toggl_project_id: 10002,
    billable: true,
    active: true,
    notes: null,
    created_at: "2025-01-10T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "proj-gamma",
    workspace_id: "ws-demo",
    slug: "gamma",
    display_name: "Project Gamma",
    client: null,
    toggl_project_id: 10003,
    billable: true,
    active: true,
    notes: null,
    created_at: "2025-02-01T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "proj-delta",
    workspace_id: "ws-demo",
    slug: "delta",
    display_name: "Project Delta",
    client: null,
    toggl_project_id: 10004,
    billable: true,
    active: true,
    notes: null,
    created_at: "2025-02-15T00:00:00Z",
    deleted_at: null,
  },
  {
    id: "proj-epsilon",
    workspace_id: "ws-demo",
    slug: "infra",
    display_name: "Internal Infra",
    client: null,
    toggl_project_id: null,
    billable: false,
    active: true,
    notes: null,
    created_at: "2025-03-01T00:00:00Z",
    deleted_at: null,
  },
];

// ---------------------------------------------------------------------------
// Usage events -- 14 days of data
// ---------------------------------------------------------------------------

const MODELS = [
  "claude-sonnet-4-5",
  "claude-haiku-3-5",
  "claude-opus-4",
  "gpt-4o",
  "codex-gpt-5-3",
];

const CAPTURE_METHODS = [
  "anthropic.claude_code.cli.session",
  "openai.codex.cli.session",
  "anthropic.api_direct.web.turn",
  "openai.api_direct.web.turn",
];

const PROJECT_IDS = SEED_PROJECTS.map((p) => p.id);
const USER_IDS = SEED_USERS.map((u) => u.id);

let _seedIdCounter = 1;

function makeEvent(
  dayOffset: number,
  seq: number,
  overrides: Partial<UsageEvent> = {}
): UsageEvent {
  const date = new Date("2025-05-15T00:00:00Z");
  date.setDate(date.getDate() + dayOffset);
  date.setHours(8 + (seq % 10));

  const model = MODELS[seq % MODELS.length];
  const captureMethod = CAPTURE_METHODS[seq % CAPTURE_METHODS.length];
  const inputTokens = 1000 + (seq * 137 + dayOffset * 53) % 8000;
  const outputTokens = 200 + (seq * 71 + dayOffset * 29) % 3000;
  const dateStr = date.toISOString().slice(0, 10);

  const id = _seedIdCounter++;

  return {
    id,
    workspace_id: "ws-demo",
    user_id: USER_IDS[seq % USER_IDS.length],
    subscription_id: null,
    project_id: seq % 7 === 0 ? null : PROJECT_IDS[seq % PROJECT_IDS.length],
    captured_at: date.toISOString(),
    date_utc: dateStr,
    date_local: dateStr,
    provider: model.startsWith("claude") ? "anthropic" : "openai",
    model,
    capture_method: captureMethod,
    aggregation_grain: "session",
    session_id: `sess-${dayOffset}-${seq}`,
    source_path: null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: inputTokens + outputTokens,
    cost_usd: null, // null until pricing_snapshots is populated
    pricing_snapshot_id: null,
    token_share_pct: null,
    project_hint: null,
    runtime_ms: null,
    notes: null,
    ingested_at: date.toISOString(),
    raw: null,
    ...overrides,
  };
}

// Generate 14 days × 10 events per day = 140 events
export const SEED_USAGE_EVENTS: UsageEvent[] = Array.from(
  { length: 14 },
  (_, day) =>
    Array.from({ length: 10 }, (_, seq) => makeEvent(day, seq + day * 10))
).flat();

// ---------------------------------------------------------------------------
// Quota windows (4 windows: Claude 5h + weekly, Codex 5h + weekly)
// ---------------------------------------------------------------------------

export const SEED_QUOTA_WINDOWS: QuotaWindow[] = [
  {
    id: 1,
    subscription_id: "sub-claude",
    window_label: "Claude Max -- 5h rolling",
    window_type: "rolling_hours",
    window_hours: 5,
    reset_anchor: null,
    active: true,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: 2,
    subscription_id: "sub-claude",
    window_label: "Claude Max -- weekly",
    window_type: "calendar_week",
    window_hours: null,
    reset_anchor: null,
    active: true,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: 3,
    subscription_id: "sub-codex",
    window_label: "Codex Pro -- 5h rolling",
    window_type: "rolling_hours",
    window_hours: 5,
    reset_anchor: null,
    active: true,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: 4,
    subscription_id: "sub-codex",
    window_label: "Codex Pro -- weekly",
    window_type: "calendar_week",
    window_hours: null,
    reset_anchor: null,
    active: true,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
    created_at: "2025-01-01T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Derived helpers for UI consumption
// ---------------------------------------------------------------------------

/** Sum tokens for a user/period from seed events */
export function seedTokensForPeriod(
  events: UsageEvent[],
  _days: number
): number {
  // Seed data is fixed to May 2025; return the full set for display purposes
  return events.reduce((sum, e) => sum + e.total_tokens, 0);
}

/** Sum cost USD from seed events (null-safe) */
export function seedCostForPeriod(
  events: UsageEvent[],
  _days: number
): number | null {
  const hasCost = events.some((e) => e.cost_usd != null);
  if (!hasCost) return null;
  return events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);
}

/** Cost per project from seed events */
export function seedCostByProject(
  events: UsageEvent[]
): { project: Project; totalCost: number | null; totalTokens: number }[] {
  const byProject = new Map<
    string,
    { totalCost: number | null; totalTokens: number }
  >();

  for (const e of events) {
    if (!e.project_id) continue;
    const existing = byProject.get(e.project_id) ?? {
      totalCost: null,
      totalTokens: 0,
    };
    byProject.set(e.project_id, {
      totalCost:
        e.cost_usd != null
          ? (existing.totalCost ?? 0) + e.cost_usd
          : existing.totalCost,
      totalTokens: existing.totalTokens + e.total_tokens,
    });
  }

  return SEED_PROJECTS.map((p) => ({
    project: p,
    totalCost: byProject.get(p.id)?.totalCost ?? null,
    totalTokens: byProject.get(p.id)?.totalTokens ?? 0,
  })).sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Daily token totals for the sparkline chart */
export function seedDailyTotals(
  events: UsageEvent[]
): { date: string; tokens: number; cost: number | null }[] {
  const byDate = new Map<string, { tokens: number; cost: number | null }>();

  for (const e of events) {
    const date = e.captured_at.slice(0, 10);
    const existing = byDate.get(date) ?? { tokens: 0, cost: null };
    byDate.set(date, {
      tokens: existing.tokens + e.total_tokens,
      cost:
        e.cost_usd != null
          ? (existing.cost ?? 0) + e.cost_usd
          : existing.cost,
    });
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { tokens, cost }]) => ({
      date,
      tokens,
      cost: cost != null ? Math.round(cost * 100) / 100 : null,
    }));
}

/** Fake quota fill percentages for the window cards */
export const SEED_QUOTA_FILLS: Record<string, number> = {
  "qw-claude-5h": 0.42,
  "qw-claude-weekly": 0.67,
  "qw-codex-5h": 0.19,
  "qw-codex-weekly": 0.31,
};
