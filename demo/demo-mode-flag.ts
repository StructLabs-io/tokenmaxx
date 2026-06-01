/**
 * Demo-mode adapter. When NEXT_PUBLIC_TOKENMAXX_DEMO=1 the page-level RSC
 * data fetchers in lib/data.ts call these instead of the live Supabase RPCs.
 *
 * The dataset itself is generated in seed-demo-data.ts and refreshed nightly
 * by rolling-refresh.ts (CF Worker).
 */

import {
  generateDemoEvents,
  generateDemoProjects,
  generateDemoSubscriptions,
} from "./seed-demo-data";

let cached: ReturnType<typeof generateDemoEvents> | null = null;

function getEvents() {
  if (!cached) cached = generateDemoEvents(365, new Date());
  return cached;
}

export function demoDashboardStats(days = 14) {
  const events = getEvents();
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
