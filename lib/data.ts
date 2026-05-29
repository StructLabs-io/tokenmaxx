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
import type { DashboardStats, DailyTotal, ProjectTotals, UsageEvent, Project, ModelBreakdownRow } from "@/lib/supabase/types";
import {
  SEED_USAGE_EVENTS,
  SEED_PROJECTS,
  SEED_USERS,
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
// Usage events (paginated list with optional filters)
// ---------------------------------------------------------------------------

export interface UsageEventsResult {
  events: UsageEvent[];
  total: number;
  usingSeedData: boolean;
}

export async function getUsageEvents(opts: {
  limit?: number;
  offset?: number;
  userId?: string;
  model?: string;
}): Promise<UsageEventsResult> {
  const { limit = 50, offset = 0, userId, model } = opts;

  if (!isServiceRoleConfigured()) {
    let events = [...SEED_USAGE_EVENTS].sort(
      (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    );
    if (userId) events = events.filter((e) => e.user_id === userId);
    if (model) events = events.filter((e) => e.model === model);
    return {
      events: events.slice(offset, offset + limit),
      total: events.length,
      usingSeedData: true,
    };
  }

  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from("usage_events")
      .select("*", { count: "exact" })
      .order("captured_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq("user_id", userId);
    if (model) query = query.eq("model", model);

    const { data, error, count } = await query as { data: any[] | null; error: any; count: number | null };
    if (error) {
      console.error("[data.getUsageEvents] Supabase error:", error);
      return { events: [], total: 0, usingSeedData: false };
    }

    return {
      events: (data ?? []) as UsageEvent[],
      total: count ?? 0,
      usingSeedData: false,
    };
  } catch (err) {
    console.error("[data.getUsageEvents] Unexpected error:", err);
    return { events: [], total: 0, usingSeedData: false };
  }
}

// ---------------------------------------------------------------------------
// Project detail (by slug) + usage for that project
// ---------------------------------------------------------------------------

export interface ProjectDetailResult {
  project: Project | null;
  events: UsageEvent[];
  dailyTotals: DailyTotal[];
  modelBreakdown: { model: string; tokens: number; cost: number | null }[];
  totalTokens: number;
  totalCost: number | null;
  usingSeedData: boolean;
}

export async function getProjectDetail(slug: string): Promise<ProjectDetailResult> {
  if (!isServiceRoleConfigured()) {
    const project = SEED_PROJECTS.find((p) => p.slug === slug) ?? null;
    if (!project) return emptyProjectDetail();

    const events = SEED_USAGE_EVENTS.filter((e) => e.project_id === project.id)
      .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());

    return buildProjectDetail(project, events, true);
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: projectRow, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("slug", slug)
      .is("deleted_at", null)
      .single() as { data: any | null; error: any };

    if (projErr || !projectRow) {
      return emptyProjectDetail();
    }

    const { data: events, error: evtErr } = await supabase
      .from("usage_events")
      .select("*")
      .eq("project_id", projectRow.id)
      .order("captured_at", { ascending: false })
      .limit(200) as { data: any[] | null; error: any };

    if (evtErr) {
      console.error("[data.getProjectDetail] Events error:", evtErr);
      return { ...emptyProjectDetail(), project: projectRow as Project };
    }

    return buildProjectDetail(projectRow as Project, (events ?? []) as UsageEvent[], false);
  } catch (err) {
    console.error("[data.getProjectDetail] Unexpected error:", err);
    return emptyProjectDetail();
  }
}

function buildProjectDetail(
  project: Project,
  events: UsageEvent[],
  usingSeedData: boolean
): ProjectDetailResult {
  // Daily totals (group by date_utc)
  const byDate = new Map<string, { tokens: number; cost: number | null }>();
  for (const e of events) {
    const date = e.date_utc;
    const existing = byDate.get(date) ?? { tokens: 0, cost: null };
    byDate.set(date, {
      tokens: existing.tokens + e.total_tokens,
      cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
    });
  }
  const dailyTotals: DailyTotal[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { tokens, cost }]) => ({ date, tokens, cost }));

  // Model breakdown
  const byModel = new Map<string, { tokens: number; cost: number | null }>();
  for (const e of events) {
    const existing = byModel.get(e.model) ?? { tokens: 0, cost: null };
    byModel.set(e.model, {
      tokens: existing.tokens + e.total_tokens,
      cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
    });
  }
  const modelBreakdown = Array.from(byModel.entries())
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.tokens - a.tokens);

  const totalTokens = events.reduce((s, e) => s + e.total_tokens, 0);
  const hasCost = events.some((e) => e.cost_usd != null);
  const totalCost = hasCost ? events.reduce((s, e) => s + (e.cost_usd ?? 0), 0) : null;

  return { project, events: events.slice(0, 10), dailyTotals, modelBreakdown, totalTokens, totalCost, usingSeedData };
}

function emptyProjectDetail(): ProjectDetailResult {
  return {
    project: null,
    events: [],
    dailyTotals: [],
    modelBreakdown: [],
    totalTokens: 0,
    totalCost: null,
    usingSeedData: false,
  };
}

// ---------------------------------------------------------------------------
// Distinct values for filter dropdowns
// ---------------------------------------------------------------------------

export interface FilterOptions {
  models: string[];
  userIds: string[];
  userNames: Map<string, string>;
  usingSeedData: boolean;
}

export async function getFilterOptions(): Promise<FilterOptions> {
  if (!isServiceRoleConfigured()) {
    const models = [...new Set(SEED_USAGE_EVENTS.map((e) => e.model))].sort();
    const userIds = SEED_USERS.map((u) => u.id);
    const userNames = new Map(SEED_USERS.map((u) => [u.id, u.display_name]));
    return { models, userIds, userNames, usingSeedData: true };
  }

  try {
    const supabase = getSupabaseServerClient();
    const [eventsRes, usersRes] = await Promise.all([
      supabase.from("usage_events").select("model").limit(500) as unknown as Promise<{ data: any[] | null }>,
      supabase.from("users").select("id,display_name").is("deleted_at", null) as unknown as Promise<{ data: any[] | null }>,
    ]);

    const models = [...new Set((eventsRes.data ?? []).map((e: any) => e.model))].sort() as string[];
    const users = (usersRes.data ?? []) as { id: string; display_name: string }[];
    const userIds = users.map((u) => u.id);
    const userNames = new Map(users.map((u) => [u.id, u.display_name]));

    return { models, userIds, userNames, usingSeedData: false };
  } catch {
    return { models: [], userIds: [], userNames: new Map(), usingSeedData: false };
  }
}

// ---------------------------------------------------------------------------
// Seed fallbacks (used when Supabase is not configured)
// ---------------------------------------------------------------------------

function buildSeedStats(days: number): DashboardStats & { usingSeedData: boolean } {
  const dailyTotals = seedDailyTotals(SEED_USAGE_EVENTS);
  const projectCosts = seedCostByProject(SEED_USAGE_EVENTS);

  const totalTokens = SEED_USAGE_EVENTS.reduce((s, e) => s + e.total_tokens, 0);
  const hasCost = SEED_USAGE_EVENTS.some((e) => e.cost_usd != null);
  const totalCost = hasCost
    ? SEED_USAGE_EVENTS.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
    : null;

  const topProjects: ProjectTotals[] = projectCosts.slice(0, 5).map(({ project, totalCost: tc, totalTokens: tt }) => ({
    id: project.id,
    slug: project.slug,
    display_name: project.display_name,
    client: project.client,
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
  const hasCost = SEED_USAGE_EVENTS.some((e) => e.cost_usd != null);
  const totalCost = hasCost
    ? SEED_USAGE_EVENTS.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
    : null;

  return {
    projects: projectCosts.map(({ project, totalCost: tc, totalTokens: tt }) => ({
      id: project.id,
      slug: project.slug,
      display_name: project.display_name,
      client: project.client,
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

// ---------------------------------------------------------------------------
// Model breakdown (for /models page)
// ---------------------------------------------------------------------------

export async function getModelBreakdown(days?: number): Promise<ModelBreakdownRow[]> {
  if (!isServiceRoleConfigured()) {
    const byModel = new Map<string, ModelBreakdownRow>();
    const cutoff = days
      ? new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10)
      : null;
    for (const e of SEED_USAGE_EVENTS) {
      if (cutoff && e.date_utc < cutoff) continue;
      const key = `${e.provider}__${e.model}`;
      const existing = byModel.get(key) ?? {
        provider: e.provider,
        model: e.model,
        event_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: null,
      };
      byModel.set(key, {
        ...existing,
        event_count: existing.event_count + 1,
        input_tokens: existing.input_tokens + e.input_tokens,
        output_tokens: existing.output_tokens + e.output_tokens,
        total_tokens: existing.total_tokens + e.total_tokens,
        cost_usd:
          e.cost_usd != null
            ? (existing.cost_usd ?? 0) + e.cost_usd
            : existing.cost_usd,
      });
    }
    return Array.from(byModel.values()).sort((a, b) => b.total_tokens - a.total_tokens);
  }

  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from("usage_events")
      .select("provider,model,input_tokens,output_tokens,total_tokens,cost_usd");

    if (days != null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      query = query.gte("date_utc", cutoff.toISOString().slice(0, 10));
    }

    const { data, error } = await query as { data: any[] | null; error: any };
    if (error || !data) {
      console.error("[data.getModelBreakdown] Supabase error:", error);
      return [];
    }

    const byModel = new Map<string, ModelBreakdownRow>();
    for (const e of data as any[]) {
      const key = `${e.provider}__${e.model}`;
      const existing = byModel.get(key) ?? {
        provider: e.provider,
        model: e.model,
        event_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: null,
      };
      byModel.set(key, {
        ...existing,
        event_count: existing.event_count + 1,
        input_tokens: existing.input_tokens + (e.input_tokens ?? 0),
        output_tokens: existing.output_tokens + (e.output_tokens ?? 0),
        total_tokens: existing.total_tokens + (e.total_tokens ?? 0),
        cost_usd:
          e.cost_usd != null
            ? (existing.cost_usd ?? 0) + e.cost_usd
            : existing.cost_usd,
      });
    }

    return Array.from(byModel.values()).sort((a, b) => b.total_tokens - a.total_tokens);
  } catch (err) {
    console.error("[data.getModelBreakdown] Unexpected error:", err);
    return [];
  }
}

// Expose seed projects for static param generation
export { SEED_PROJECTS };
