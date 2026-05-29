/**
 * MVP placeholder seed data.
 * Replace once Supabase is wired -- see lib/supabase/client.ts.
 *
 * All data is generic/fictional. No real user names, projects, or costs.
 */

import type { UsageEvent, Project, User, QuotaWindow } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Users (2 fake humans + 1 service account)
// ---------------------------------------------------------------------------

export const SEED_USERS: User[] = [
  {
    id: "user-alice",
    created_at: "2025-01-01T00:00:00Z",
    workspace_id: "ws-demo",
    display_name: "Alice",
    account_type: "human",
    capture_name: "alice-macbook",
  },
  {
    id: "user-bob",
    created_at: "2025-01-01T00:00:00Z",
    workspace_id: "ws-demo",
    display_name: "Bob",
    account_type: "human",
    capture_name: "bob-macbook",
  },
  {
    id: "user-svc",
    created_at: "2025-01-01T00:00:00Z",
    workspace_id: "ws-demo",
    display_name: "demo-server",
    account_type: "service",
    capture_name: "demo-server",
  },
];

// ---------------------------------------------------------------------------
// Projects (5 fake projects)
// ---------------------------------------------------------------------------

export const SEED_PROJECTS: Project[] = [
  {
    id: "proj-alpha",
    created_at: "2025-01-05T00:00:00Z",
    workspace_id: "ws-demo",
    name: "Project Alpha",
    slug: "alpha",
    toggl_project_id: 10001,
    color: "#6366f1",
    archived: false,
  },
  {
    id: "proj-beta",
    created_at: "2025-01-10T00:00:00Z",
    workspace_id: "ws-demo",
    name: "Project Beta",
    slug: "beta",
    toggl_project_id: 10002,
    color: "#f59e0b",
    archived: false,
  },
  {
    id: "proj-gamma",
    created_at: "2025-02-01T00:00:00Z",
    workspace_id: "ws-demo",
    name: "Project Gamma",
    slug: "gamma",
    toggl_project_id: 10003,
    color: "#10b981",
    archived: false,
  },
  {
    id: "proj-delta",
    created_at: "2025-02-15T00:00:00Z",
    workspace_id: "ws-demo",
    name: "Project Delta",
    slug: "delta",
    toggl_project_id: 10004,
    color: "#ef4444",
    archived: false,
  },
  {
    id: "proj-epsilon",
    created_at: "2025-03-01T00:00:00Z",
    workspace_id: "ws-demo",
    name: "Internal Infra",
    slug: "infra",
    toggl_project_id: null,
    color: "#8b5cf6",
    archived: false,
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

const TOOLS = ["claude_code", "codex", "browser", "api_direct"];

const PROJECT_IDS = SEED_PROJECTS.map((p) => p.id);
const USER_IDS = SEED_USERS.map((u) => u.id);

function makeEvent(
  dayOffset: number,
  seq: number,
  overrides: Partial<UsageEvent> = {}
): UsageEvent {
  const date = new Date("2025-05-15T00:00:00Z");
  date.setDate(date.getDate() + dayOffset);
  date.setHours(8 + (seq % 10));

  const model = MODELS[seq % MODELS.length];
  const tool = TOOLS[seq % TOOLS.length];
  const inputTokens = 1000 + (seq * 137 + dayOffset * 53) % 8000;
  const outputTokens = 200 + (seq * 71 + dayOffset * 29) % 3000;
  const costUsd = (inputTokens * 0.000003 + outputTokens * 0.000015);

  return {
    id: `evt-${dayOffset}-${seq}`,
    created_at: date.toISOString(),
    user_id: USER_IDS[seq % USER_IDS.length],
    workspace_id: "ws-demo",
    project_id: seq % 7 === 0 ? null : PROJECT_IDS[seq % PROJECT_IDS.length],
    model,
    provider: model.startsWith("claude") ? "anthropic" : model.startsWith("gpt") ? "openai" : "openai",
    tool,
    surface: tool === "claude_code" ? "cli" : tool === "codex" ? "cli" : "web",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: Math.round(costUsd * 10000) / 10000,
    capture_method: `${model.startsWith("claude") ? "anthropic" : "openai"}.${tool}.cli.session`,
    aggregation_grain: "session",
    session_start: date.toISOString(),
    session_end: new Date(date.getTime() + (20 + seq % 40) * 60 * 1000).toISOString(),
    metadata: null,
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
    id: "qw-claude-5h",
    provider: "anthropic",
    window_type: "rolling_5h",
    label: "Claude Max -- 5h rolling",
    cap_tokens: null, // Unknown until scraping ships
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
  },
  {
    id: "qw-claude-weekly",
    provider: "anthropic",
    window_type: "weekly",
    label: "Claude Max -- weekly",
    cap_tokens: null,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
  },
  {
    id: "qw-codex-5h",
    provider: "openai",
    window_type: "rolling_5h",
    label: "Codex Pro -- 5h rolling",
    cap_tokens: null,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
  },
  {
    id: "qw-codex-weekly",
    provider: "openai",
    window_type: "weekly",
    label: "Codex Pro -- weekly",
    cap_tokens: null,
    notes: "Cap unknown -- pending quota scraping integration (v1.0)",
  },
];

// ---------------------------------------------------------------------------
// Derived helpers for UI consumption
// ---------------------------------------------------------------------------

/** Sum tokens for a user/period from seed events */
export function seedTokensForPeriod(
  events: UsageEvent[],
  days: number
): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  // Seed data is fixed to May 2025; return the full set for display purposes
  return events.reduce((sum, e) => sum + e.total_tokens, 0);
}

/** Sum cost USD from seed events */
export function seedCostForPeriod(
  events: UsageEvent[],
  _days: number
): number {
  return events.reduce((sum, e) => sum + e.cost_usd, 0);
}

/** Cost per project from seed events */
export function seedCostByProject(
  events: UsageEvent[]
): { project: Project; totalCost: number; totalTokens: number }[] {
  const byProject = new Map<
    string,
    { totalCost: number; totalTokens: number }
  >();

  for (const e of events) {
    if (!e.project_id) continue;
    const existing = byProject.get(e.project_id) ?? {
      totalCost: 0,
      totalTokens: 0,
    };
    byProject.set(e.project_id, {
      totalCost: existing.totalCost + e.cost_usd,
      totalTokens: existing.totalTokens + e.total_tokens,
    });
  }

  return SEED_PROJECTS.map((p) => ({
    project: p,
    totalCost: Math.round((byProject.get(p.id)?.totalCost ?? 0) * 100) / 100,
    totalTokens: byProject.get(p.id)?.totalTokens ?? 0,
  })).sort((a, b) => b.totalCost - a.totalCost);
}

/** Daily token totals for the sparkline chart */
export function seedDailyTotals(
  events: UsageEvent[]
): { date: string; tokens: number; cost: number }[] {
  const byDate = new Map<string, { tokens: number; cost: number }>();

  for (const e of events) {
    const date = e.created_at.slice(0, 10);
    const existing = byDate.get(date) ?? { tokens: 0, cost: 0 };
    byDate.set(date, {
      tokens: existing.tokens + e.total_tokens,
      cost: existing.cost + e.cost_usd,
    });
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { tokens, cost }]) => ({
      date,
      tokens,
      cost: Math.round(cost * 100) / 100,
    }));
}

/** Fake quota fill percentages for the window cards */
export const SEED_QUOTA_FILLS: Record<string, number> = {
  "qw-claude-5h": 0.42,
  "qw-claude-weekly": 0.67,
  "qw-codex-5h": 0.19,
  "qw-codex-weekly": 0.31,
};
