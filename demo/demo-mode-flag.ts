/**
 * Demo-mode adapter. When NEXT_PUBLIC_TOKENMAXX_DEMO=1 the page-level RSC
 * data fetchers in lib/data.ts call these instead of the live Supabase RPCs.
 *
 * The dataset itself is generated in seed-demo-data.ts and refreshed nightly
 * by rolling-refresh.ts (CF Worker).
 */

import {
  type DemoEvent,
  generateDemoEvents,
  generateDemoProjects,
  generateDemoQuotaWindows,
  generateDemoSubscriptions,
  generateDemoUsers,
} from "./seed-demo-data";
import { DEMO_USERS } from "./fictional-names";

let cachedEvents: DemoEvent[] | null = null;

export function demoEvents(): DemoEvent[] {
  if (!cachedEvents) cachedEvents = generateDemoEvents(365, new Date());
  return cachedEvents;
}

export function demoDashboardStats(days = 14) {
  const events = demoEvents();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const sub = events.filter((e) => e.date_utc >= cutoffIso);
  const byDate = new Map<string, { tokens: number; cost: number }>();
  for (const e of sub) {
    const x = byDate.get(e.date_utc) ?? { tokens: 0, cost: 0 };
    byDate.set(e.date_utc, { tokens: x.tokens + e.total_tokens, cost: x.cost + e.cost_usd });
  }
  const dailyTotals = Array.from(byDate.entries()).sort().map(([d, v]) => ({ date: d, tokens: v.tokens, cost: v.cost }));
  const byProject = new Map<string, { tokens: number; cost: number }>();
  for (const e of sub) {
    const x = byProject.get(e.project_id) ?? { tokens: 0, cost: 0 };
    byProject.set(e.project_id, { tokens: x.tokens + e.total_tokens, cost: x.cost + e.cost_usd });
  }
  const projects = generateDemoProjects();
  const topProjects = Array.from(byProject.entries())
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .slice(0, 5)
    .map(([id, v]) => {
      const p = projects.find((x) => x.id === id);
      return { id, slug: p?.slug ?? id, display_name: p?.display_name ?? id, client: p?.client ?? null, totalTokens: v.tokens, totalCost: v.cost };
    });
  return {
    totalEvents: sub.length,
    periodDays: days,
    totalTokens: sub.reduce((s, e) => s + e.total_tokens, 0),
    totalCost: sub.reduce((s, e) => s + e.cost_usd, 0),
    dailyTotals,
    topProjects,
    usingSeedData: true,
  };
}

export function demoProjects() {
  return generateDemoProjects();
}
export function demoSubscriptions() {
  return generateDemoSubscriptions();
}

export function demoQuotaWindowDetails() {
  const windows = generateDemoQuotaWindows();
  const subs = generateDemoSubscriptions();
  const subById = new Map(subs.map((s) => [s.id, s]));
  // Match the shape of QuotaWindowDetail from lib/supabase/types
  return windows.map((w) => {
    const s = subById.get(w.subscription_id);
    return {
      ...w,
      plan_name: s?.plan_name ?? null,
      monthly_cost_usd: s?.monthly_cost_usd ?? null,
      management_urls: s?.management_urls ?? [],
    };
  });
}

export function demoModelBreakdown(days?: number) {
  const events = demoEvents();
  const cutoff = days ? new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10) : null;
  const byModel = new Map<string, { provider: string; model: string; event_count: number; input_tokens: number; output_tokens: number; total_tokens: number; cost_usd: number }>();
  for (const e of events) {
    if (cutoff && e.date_utc < cutoff) continue;
    const existing = byModel.get(e.model) ?? {
      provider: e.provider,
      model: e.model,
      event_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
    };
    existing.event_count++;
    existing.input_tokens += e.input_tokens;
    existing.output_tokens += e.output_tokens;
    existing.total_tokens += e.total_tokens;
    existing.cost_usd += e.cost_usd;
    byModel.set(e.model, existing);
  }
  return Array.from(byModel.values()).sort((a, b) => b.total_tokens - a.total_tokens);
}

export function demoUsersSummary(days = 30) {
  const events = demoEvents();
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const sub = events.filter((e) => e.date_utc >= cutoff);
  const users = generateDemoUsers();
  const byUser = new Map<string, { tokens: number; cost: number }>();
  for (const e of sub) {
    const ex = byUser.get(e.user_id) ?? { tokens: 0, cost: 0 };
    ex.tokens += e.total_tokens;
    ex.cost += e.cost_usd;
    byUser.set(e.user_id, ex);
  }
  const DEMO_USER_TIMEZONES: Record<string, string> = {
    "demo-user-rivera": "America/Los_Angeles",
    "demo-user-osei": "Europe/London",
    "demo-user-svc-ci": "Australia/Sydney",
    "demo-user-svc-bot": "Asia/Kuala_Lumpur",
  };

  const rows = users.map((u) => {
    const m = byUser.get(u.id) ?? { tokens: 0, cost: 0 };
    return {
      id: u.id,
      slug: u.id.replace(/^demo-user-/, ""),
      display_name: u.display_name,
      account_type: u.kind as "human" | "service",
      email: u.kind === "human" ? `${u.display_name.toLowerCase().replace(/\s+/g, ".")}@demo.tokenmaxx.example` : null,
      default_timezone: DEMO_USER_TIMEZONES[u.id] ?? "UTC",
      total_tokens: m.tokens,
      cost_usd: m.cost,
    };
  }).sort((a, b) => b.total_tokens - a.total_tokens);
  const totalHuman = rows.filter((r) => r.account_type === "human").reduce((s, r) => s + r.total_tokens, 0);
  const totalService = rows.filter((r) => r.account_type === "service").reduce((s, r) => s + r.total_tokens, 0);
  return {
    users: rows,
    totalHuman,
    totalService,
    totalTokens: totalHuman + totalService,
    usingSeedData: true,
  };
}

/**
 * Period-specific daily buckets for the wrap page bar chart.
 * period="month" → daily buckets for the current calendar month.
 * period="week"  → daily buckets for the current Mon–Sun week.
 */
export function demoWrapPeriodBuckets(period: "month" | "week") {
  const events = demoEvents();
  const now = new Date();

  let fromDate: string;
  let toDate: string;

  if (period === "month") {
    fromDate = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    toDate = now.toISOString().slice(0, 10);
  } else {
    // ISO week: Mon–Sun
    const dow = now.getUTCDay();
    const diff = dow === 0 ? 6 : dow - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff);
    fromDate = monday.toISOString().slice(0, 10);
    toDate = now.toISOString().slice(0, 10);
  }

  const sub = events.filter((e) => e.date_utc >= fromDate && e.date_utc <= toDate);
  const byDate = new Map<string, number>();
  for (const e of sub) {
    byDate.set(e.date_utc, (byDate.get(e.date_utc) ?? 0) + e.total_tokens);
  }

  // Fill every day in the range so chart has no gaps
  const buckets: { label: string; tokens: number }[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const shortLabel = cursor.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    buckets.push({ label: shortLabel, tokens: byDate.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { buckets, fromDate, toDate };
}

export function demoWrapStats() {
  const events = demoEvents();
  const year = new Date().getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const sub = events.filter((e) => e.date_utc >= yearStart);
  if (sub.length === 0) return null;

  const totalTokens = sub.reduce((s, e) => s + e.total_tokens, 0);
  const totalCost = sub.reduce((s, e) => s + e.cost_usd, 0);
  const totalEvents = sub.length;

  // Top model
  const byModel = new Map<string, number>();
  for (const e of sub) byModel.set(e.model, (byModel.get(e.model) ?? 0) + e.total_tokens);
  const [topModel, topModelTokens] = [...byModel.entries()].sort(([, a], [, b]) => b - a)[0] ?? [null, 0];

  // Provider breakdown
  const byProvider = new Map<string, { tokens: number; cost: number }>();
  for (const e of sub) {
    const ex = byProvider.get(e.provider) ?? { tokens: 0, cost: 0 };
    byProvider.set(e.provider, { tokens: ex.tokens + e.total_tokens, cost: ex.cost + e.cost_usd });
  }
  const providerBreakdown = [...byProvider.entries()]
    .map(([provider, v]) => ({ provider, tokens: v.tokens, cost: v.cost, pct: Math.round((v.tokens / totalTokens) * 100) }))
    .sort((a, b) => b.tokens - a.tokens);

  // Monthly totals
  const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const byMonth = new Map<number, number>();
  for (const e of sub) {
    const m = parseInt(e.date_utc.slice(5, 7), 10) - 1;
    byMonth.set(m, (byMonth.get(m) ?? 0) + e.total_tokens);
  }
  const monthlyTotals = monthLabels.map((label, i) => ({ label, tokens: byMonth.get(i) ?? 0 }));
  const topMonthEntry = [...byMonth.entries()].sort(([, a], [, b]) => b - a)[0];
  const topMonth = topMonthEntry ? monthLabels[topMonthEntry[0]] : null;
  const topMonthTokens = topMonthEntry?.[1] ?? 0;

  // Peak day
  const byDate = new Map<string, number>();
  for (const e of sub) byDate.set(e.date_utc, (byDate.get(e.date_utc) ?? 0) + e.total_tokens);
  const [peakDay, peakDayTokens] = [...byDate.entries()].sort(([, a], [, b]) => b - a)[0] ?? [null, 0];

  // Top projects
  const projects = generateDemoProjects();
  const byProject = new Map<string, { tokens: number; cost: number }>();
  for (const e of sub) {
    const ex = byProject.get(e.project_id) ?? { tokens: 0, cost: 0 };
    byProject.set(e.project_id, { tokens: ex.tokens + e.total_tokens, cost: ex.cost + e.cost_usd });
  }
  const topProjects = [...byProject.entries()]
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .slice(0, 5)
    .map(([id, v]) => {
      const p = projects.find((x) => x.id === id);
      return { id, display_name: p?.display_name ?? id, client: p?.client ?? null, tokens: v.tokens, cost: v.cost };
    });

  return {
    year,
    totalTokens,
    totalCost,
    totalEvents,
    topModel,
    topModelTokens,
    topMonth,
    topMonthTokens,
    peakDay,
    peakDayTokens,
    providerBreakdown,
    topProjects,
    monthlyTotals,
  };
}

export interface DemoUsageEventsOpts {
  limit?: number;
  offset?: number;
  userId?: string;
  model?: string;
  from?: string;
  to?: string;
  projectId?: string | null;
}

export function demoUsageEvents(opts: DemoUsageEventsOpts) {
  const { limit = 50, offset = 0, userId, model, from, to, projectId } = opts;
  let events = [...demoEvents()].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
  );
  if (userId) events = events.filter((e) => e.user_id === userId);
  if (model) events = events.filter((e) => e.model === model);
  if (from) events = events.filter((e) => e.date_utc >= from);
  if (to) events = events.filter((e) => e.date_utc <= to);
  if (projectId === null) {
    events = events.filter((e) => !e.project_id);
  } else if (projectId) {
    events = events.filter((e) => e.project_id === projectId);
  }
  return {
    events: events.slice(offset, offset + limit),
    total: events.length,
  };
}

export function demoFilterOptions() {
  const events = demoEvents();
  const models = [...new Set(events.map((e) => e.model))].sort();
  const users = generateDemoUsers();
  const projects = generateDemoProjects();
  const userIds = users.map((u) => u.id);
  const userNames = new Map(users.map((u) => [u.id, u.display_name]));
  const projectIds = projects.map((p) => p.id);
  const projectNames = new Map(
    projects.map((p) => [p.id, p.client ? `${p.client} / ${p.display_name}` : p.display_name]),
  );
  return { models, userIds, userNames, projectIds, projectNames, usingSeedData: true };
}

export function demoProjectDetail(slug: string) {
  const projects = generateDemoProjects();
  const project = projects.find((p) => p.slug === slug);
  if (!project) {
    return {
      project: null,
      events: [],
      dailyTotals: [],
      modelBreakdown: [],
      totalTokens: 0,
      totalCost: null,
      usingSeedData: true,
    };
  }
  const events = demoEvents()
    .filter((e) => e.project_id === project.id)
    .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());

  const byDate = new Map<string, { tokens: number; cost: number }>();
  for (const e of events) {
    const ex = byDate.get(e.date_utc) ?? { tokens: 0, cost: 0 };
    byDate.set(e.date_utc, { tokens: ex.tokens + e.total_tokens, cost: ex.cost + e.cost_usd });
  }
  const dailyTotals = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, tokens: v.tokens, cost: v.cost }));

  const byModel = new Map<string, { tokens: number; cost: number }>();
  for (const e of events) {
    const ex = byModel.get(e.model) ?? { tokens: 0, cost: 0 };
    byModel.set(e.model, { tokens: ex.tokens + e.total_tokens, cost: ex.cost + e.cost_usd });
  }
  const modelBreakdown = [...byModel.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost }))
    .sort((a, b) => b.tokens - a.tokens);

  return {
    project: {
      id: project.id,
      slug: project.slug,
      display_name: project.display_name,
      client: project.client,
      workspace_id: project.workspace_id,
      active: project.active,
      billable: project.billable,
      toggl_project_id: project.toggl_project_id,
      notes: project.notes,
      deleted_at: project.deleted_at,
      created_at: project.created_at,
    },
    events: events.slice(0, 10) as any[],
    dailyTotals,
    modelBreakdown,
    totalTokens: events.reduce((s, e) => s + e.total_tokens, 0),
    totalCost: events.reduce((s, e) => s + e.cost_usd, 0),
    usingSeedData: true,
  };
}

export function demoUnattributedGroups() {
  // Demo dataset is fully attributed by construction — no unattributed events.
  return [] as any[];
}

export function demoProjectsForSelect() {
  return generateDemoProjects().map((p) => ({
    id: p.id,
    slug: p.slug,
    display_name: p.display_name,
    client: p.client,
    totalTokens: 0,
    totalCost: null as number | null,
  }));
}

// Re-export demoEvents access for /api/* routes that need raw events.
export { DEMO_USERS };
