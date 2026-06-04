/**
 * Demo seed generator.
 *
 * Produces 12 months of plausible usage events. Distribution rules:
 * - Weekdays heavier than weekends
 * - 09:00–18:00 working hours peak
 * - Mantis-like dominant project ~30% of activity (here: "Meridian Robotics")
 * - Trailing 7 days are "today-shaped" so the dashboard never looks stale
 *
 * Used by demo-mode-flag.ts when NEXT_PUBLIC_TOKENMAXX_DEMO=1.
 */

import { ALL_PROJECTS, DEMO_USERS, MODELS, slugify } from "./fictional-names";

export interface DemoEvent {
  id: number;
  captured_at: string;
  date_utc: string;
  user_id: string;
  provider: string;
  model: string;
  project_id: string;
  workspace_id: string;
  capture_method: string;
  session_id: string;
  session_title: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_locked: boolean;
}

const WORKSPACE = "demo-workspace-00000000-0000-0000-0000-000000000000";

function rng(seed: number) {
  // Mulberry32 — deterministic across runs
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, weighted: { value: T; weight: number }[]): T {
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let r = rand() * total;
  for (const w of weighted) {
    if (r < w.weight) return w.value;
    r -= w.weight;
  }
  return weighted[weighted.length - 1].value;
}

const SAMPLE_TITLES = [
  "fix the auth flow that's hanging on safari",
  "RAG indexer — chunk by section header instead of fixed size",
  "draft a follow-up email for the campaign brief",
  "why is the airtable sync skipping the new client rows",
  "explain why this useEffect runs twice in strict mode",
  "set up the brand audit deck — start with the existing palette",
  "schedule the next cohort onboarding for Birchwood",
  "compare the gpt-5.5 vs claude-opus-4-7 outputs on the discovery triage prompt",
  "add a webhook trigger when the new POS row hits the catalog feed",
  "review the calendar triage flow — too many false positives on personal events",
];

export function generateDemoEvents(daysBack = 365, today = new Date()): DemoEvent[] {
  const rand = rng(42);
  const events: DemoEvent[] = [];
  let id = 1;
  // Project weights — Meridian Robotics is the dominant Mantis-equivalent
  const projectWeights = ALL_PROJECTS.map((p) => ({
    value: p,
    weight: p.client === "Meridian Robotics" ? 3
      : p.client === "Internal" ? 2
      : 1,
  }));

  for (let d = daysBack - 1; d >= 0; d--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - d);
    const dow = day.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const baseSessions = isWeekend
      ? Math.floor(2 + rand() * 5)
      : Math.floor(8 + rand() * 18);

    for (let s = 0; s < baseSessions; s++) {
      const hour = 8 + Math.floor(rand() * 11);   // 8am–7pm
      const min = Math.floor(rand() * 60);
      const sec = Math.floor(rand() * 60);
      const captured = new Date(day);
      captured.setUTCHours(hour, min, sec, 0);

      const project = pick(rand, projectWeights);
      const model = pick(rand, MODELS.map((m) => ({ value: m, weight: m.provider === "anthropic" ? 3 : 2 })));
      // Humans dominate; service accounts emit short, bursty traffic.
      const userWeights = DEMO_USERS.map((u) => ({
        value: u,
        weight: u.kind === "human" ? 5 : 1,
      }));
      const user = pick(rand, userWeights);
      const inputT = Math.floor(800 + rand() * 18000);
      const outputT = Math.floor(400 + rand() * 9000);
      const cacheCreate = Math.floor(rand() * 4000);
      const cacheRead = Math.floor(rand() * 60000);
      const total = inputT + outputT + cacheCreate + cacheRead;
      const cost =
        (inputT * model.input_per_m + outputT * model.output_per_m +
         cacheCreate * model.input_per_m + cacheRead * model.cache_read_per_m) / 1_000_000;

      events.push({
        id: id++,
        captured_at: captured.toISOString(),
        date_utc: captured.toISOString().slice(0, 10),
        user_id: user.id,
        provider: model.provider,
        model: model.id,
        project_id: project.slug,
        workspace_id: WORKSPACE,
        capture_method: `${model.provider}.ccusage.cli.demo`,
        session_id: `demo-${id}-${captured.getTime()}`,
        session_title: rand() < 0.6 ? SAMPLE_TITLES[Math.floor(rand() * SAMPLE_TITLES.length)] : null,
        input_tokens: inputT,
        output_tokens: outputT,
        cache_creation_tokens: cacheCreate,
        cache_read_tokens: cacheRead,
        total_tokens: total,
        cost_usd: Math.round(cost * 100) / 100,
        cost_locked: false,
      });
    }
  }

  return events;
}

export function generateDemoProjects() {
  return ALL_PROJECTS.map((p, i) => ({
    id: p.slug,
    slug: p.slug,
    display_name: p.project,
    client: p.client === "Internal" ? null : p.client,
    workspace_id: WORKSPACE,
    active: true,
    billable: p.client !== "Internal",
    toggl_project_id: null,
    notes: null,
    deleted_at: null,
    created_at: new Date(Date.now() - 365 * 86400 * 1000).toISOString(),
  }));
}

export function generateDemoUsers() {
  return DEMO_USERS.map((u) => ({
    id: u.id,
    workspace_id: WORKSPACE,
    display_name: u.display_name,
    kind: u.kind, // "human" | "service"
    deleted_at: null,
    created_at: new Date(Date.now() - 365 * 86400 * 1000).toISOString(),
  }));
}

/**
 * Plausible quota windows for the two demo subscriptions. Shape matches the
 * QuotaWindowDetail interface in lib/data.ts so /quota renders end-to-end.
 */
export function generateDemoQuotaWindows() {
  const now = new Date().toISOString();
  const hours = (h: number) => h * 60 * 60 * 1000;
  return [
    {
      id: 1,
      subscription_id: "demo-sub-anthropic",
      window_label: "Claude Max — 5h rolling",
      window_type: "rolling_hours" as const,
      window_hours: 5,
      notes: "Resets every 5 hours",
      provider: "anthropic",
      tokens_in_window: 1_200_000,
      fillPct: 0.42,
      ms_until_reset: hours(2.5),
      latest_observed_at: now,
    },
    {
      id: 2,
      subscription_id: "demo-sub-anthropic",
      window_label: "Claude Max — weekly",
      window_type: "calendar_week" as const,
      window_hours: 168,
      notes: "Resets every Monday 00:00 local",
      provider: "anthropic",
      tokens_in_window: 18_400_000,
      fillPct: 0.67,
      ms_until_reset: hours(48),
      latest_observed_at: now,
    },
    {
      id: 3,
      subscription_id: "demo-sub-openai",
      window_label: "Codex Pro — 5h rolling",
      window_type: "rolling_hours" as const,
      window_hours: 5,
      notes: "Resets every 5 hours",
      provider: "openai-codex",
      tokens_in_window: 720_000,
      fillPct: 0.31,
      ms_until_reset: hours(1.7),
      latest_observed_at: now,
    },
    {
      id: 4,
      subscription_id: "demo-sub-openai",
      window_label: "Codex Pro — weekly",
      window_type: "calendar_week" as const,
      window_hours: 168,
      notes: "Resets weekly",
      provider: "openai-codex",
      tokens_in_window: 8_900_000,
      fillPct: 0.54,
      ms_until_reset: hours(72),
      latest_observed_at: now,
    },
  ];
}

export function generateDemoSubscriptions() {
  return [
    {
      id: "demo-sub-anthropic",
      workspace_id: WORKSPACE,
      provider: "anthropic",
      plan_name: "Claude Max 5x",
      monthly_cost_usd: 100,
      active: true,
      started_at: "2025-08-01",
      management_urls: [
        { label: "Billing", url: "https://claude.ai/settings/billing" },
        { label: "Usage", url: "https://claude.ai/settings/usage" },
      ],
      billing_cycle_anchor: "2025-08-01",
      created_at: "2025-08-01T00:00:00Z",
    },
    {
      id: "demo-sub-openai",
      workspace_id: WORKSPACE,
      provider: "openai-codex",
      plan_name: "ChatGPT Pro",
      monthly_cost_usd: 100,
      active: true,
      started_at: "2025-09-15",
      management_urls: [
        { label: "Account", url: "https://chatgpt.com/#settings/Account" },
        { label: "Codex Analytics", url: "https://chatgpt.com/codex/cloud/settings/analytics" },
      ],
      billing_cycle_anchor: "2025-09-15",
      created_at: "2025-09-15T00:00:00Z",
    },
  ];
}
