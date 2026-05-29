/**
 * Server-side data fetching functions.
 *
 * These call the Supabase server client directly (not via fetch to our own API).
 * Use these in RSC (React Server Components) only.
 *
 * For client components, fetch from the /api/* Route Handlers instead.
 *
 * All functions degrade gracefully when Supabase is not configured:
 *   - Return empty/seed data when isServiceRoleConfigured() is false
 *   - Never throw to the caller -- errors are logged and empty state returned
 */

import { isServiceRoleConfigured, getSupabaseServerClient } from "@/lib/supabase/client";
import type { DashboardStats, DailyTotal, ProjectTotals } from "@/lib/supabase/types";
import {
  SEED_USAGE_EVENTS,
  SEED_PROJECTS,
  seedCostByProject,
  seedDailyTotals,
} from "@/lib/seed-data";

export { isServiceRoleConfigured };

// ---------------------------------------------------------------------------
// Home page data
// ---------------------------------------------------------------------------

export async function getDashboardStats(days = 14): Promise<DashboardStats & { usingSeedData: boolean }> {
  if (!isServiceRoleConfigured()) {
    return buildSeedStats(days);
  }

  try {
    const supabase = getSupabaseServerClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const { data: events, error, count } = await supabase
      .from("usage_events")
      .select("date_utc,total_tokens,cost_usd,project_id", { count: "exact" })
      .gte("date_utc", cutoffDate)
      .order("date_utc", { ascending: true }) as { data: any[] | null; error: any; count: number | null };

    if (error) {
      console.error("[data.getDashboardStats] Supabase error:", error);
      return buildSeedStats(days);
    }

    if (!events || events.length === 0) {
      return { ...emptyStats(days), usingSeedData: false };
    }

    // Daily totals
    const byDate = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of events as any[]) {
      const existing = byDate.get(e.date_utc) ?? { tokens: 0, cost: null };
      byDate.set(e.date_utc, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }
    const dailyTotals: DailyTotal[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { tokens, cost }]) => ({ date, tokens, cost }));

    // Project totals
    const byProject = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of events as any[]) {
      if (!e.project_id) continue;
      const existing = byProject.get(e.project_id) ?? { tokens: 0, cost: null };
      byProject.set(e.project_id, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }

    const projectIds = Array.from(byProject.keys());
    let topProjects: ProjectTotals[] = [];
    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("projects")
        .select("id,slug,display_name,client")
        .in("id", projectIds) as { data: any[] | null };

      topProjects = ((projects ?? []) as any[])
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          display_name: p.display_name,
          client: p.client,
          totalTokens: byProject.get(p.id)?.tokens ?? 0,
          totalCost: byProject.get(p.id)?.cost ?? null,
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 5);
    }

    const totalTokens = events.reduce((s, e) => s + (e.total_tokens ?? 0), 0);
    const hasCost = events.some((e) => e.cost_usd != null);

    return {
      totalEvents: count ?? events.length,
      periodDays: days,
      totalTokens,
      totalCost: hasCost ? events.reduce((s, e) => s + (e.cost_usd ?? 0), 0) : null,
      dailyTotals,
      topProjects,
      usingSeedData: false,
    };
  } catch (err) {
    console.error("[data.getDashboardStats] Unexpected error:", err);
    return buildSeedStats(days);
  }
}

// ---------------------------------------------------------------------------
// Projects page data
// ---------------------------------------------------------------------------

export async function getProjectsList(days = 30): Promise<{
  projects: ProjectTotals[];
  totalEvents: number;
  totalCost: number | null;
  unattributedCount: number;
  usingSeedData: boolean;
}> {
  if (!isServiceRoleConfigured()) {
    return buildSeedProjectsList();
  }

  try {
    const supabase = getSupabaseServerClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id,slug,display_name,client")
      .is("deleted_at", null)
      .order("display_name") as { data: any[] | null; error: any };

    if (projErr || !projectRows) {
      console.error("[data.getProjectsList] Projects error:", projErr);
      return buildSeedProjectsList();
    }

    const { data: events, error: evtErr, count } = await supabase
      .from("usage_events")
      .select("project_id,total_tokens,cost_usd", { count: "exact" })
      .gte("date_utc", cutoffDate) as { data: any[] | null; error: any; count: number | null };

    if (evtErr) {
      console.error("[data.getProjectsList] Events error:", evtErr);
      return buildSeedProjectsList();
    }

    const allEvents = (events as any[] ?? []);
    const byProject = new Map<string, { tokens: number; cost: number | null }>();
    let unattributedCount = 0;

    for (const e of allEvents as any[]) {
      if (!e.project_id) { unattributedCount++; continue; }
      const existing = byProject.get(e.project_id) ?? { tokens: 0, cost: null };
      byProject.set(e.project_id, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }

    const projects: ProjectTotals[] = (projectRows as any[]).map((p) => ({
      id: p.id,
      slug: p.slug,
      display_name: p.display_name,
      client: p.client,
      totalTokens: byProject.get(p.id)?.tokens ?? 0,
      totalCost: byProject.get(p.id)?.cost ?? null,
    }));

    const hasCost = allEvents.some((e) => e.cost_usd != null);
    const totalCost = hasCost
      ? allEvents.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
      : null;

    return {
      projects,
      totalEvents: count ?? allEvents.length,
      totalCost,
      unattributedCount,
      usingSeedData: false,
    };
  } catch (err) {
    console.error("[data.getProjectsList] Unexpected error:", err);
    return buildSeedProjectsList();
  }
}

// ---------------------------------------------------------------------------
// Seed fallbacks (used when Supabase is not configured)
// ---------------------------------------------------------------------------

function buildSeedStats(days: number): DashboardStats & { usingSeedData: boolean } {
  const dailyTotals = seedDailyTotals(SEED_USAGE_EVENTS);
  const projectCosts = seedCostByProject(SEED_USAGE_EVENTS);

  const totalTokens = SEED_USAGE_EVENTS.reduce((s, e) => s + e.total_tokens, 0);
  const totalCost = SEED_USAGE_EVENTS.reduce((s, e) => s + e.cost_usd, 0);

  const topProjects: ProjectTotals[] = projectCosts.slice(0, 5).map(({ project, totalCost: tc, totalTokens: tt }) => ({
    id: project.id,
    slug: project.slug,
    display_name: project.name,
    client: null,
    totalTokens: tt,
    totalCost: tc,
  }));

  return {
    totalEvents: SEED_USAGE_EVENTS.length,
    periodDays: days,
    totalTokens,
    totalCost,
    dailyTotals,
    topProjects,
    usingSeedData: true,
  };
}

function buildSeedProjectsList() {
  const projectCosts = seedCostByProject(SEED_USAGE_EVENTS);
  const unattributedCount = SEED_USAGE_EVENTS.filter((e) => !e.project_id).length;
  const totalCost = SEED_USAGE_EVENTS.reduce((s, e) => s + e.cost_usd, 0);

  return {
    projects: projectCosts.map(({ project, totalCost: tc, totalTokens: tt }) => ({
      id: project.id,
      slug: project.slug,
      display_name: project.name,
      client: null,
      totalTokens: tt,
      totalCost: tc,
    })),
    totalEvents: SEED_USAGE_EVENTS.length,
    totalCost,
    unattributedCount,
    usingSeedData: true,
  };
}

function emptyStats(days: number): DashboardStats {
  return {
    totalEvents: 0,
    periodDays: days,
    totalTokens: 0,
    totalCost: null,
    dailyTotals: [],
    topProjects: [],
  };
}

// Expose seed projects for static param generation
export { SEED_PROJECTS };
