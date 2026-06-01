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
import type { DashboardStats, DailyTotal, ProjectTotals, UsageEvent, Project, ModelBreakdownRow, SubscriptionSummary, QuotaWindowWithUsage, UserSummaryRow } from "@/lib/supabase/types";
import {
  SEED_USAGE_EVENTS,
  SEED_PROJECTS,
  SEED_USERS,
  seedCostByProject,
  seedDailyTotals,
} from "@/lib/seed-data";

export { isServiceRoleConfigured };

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

/**
 * Fetch all rows from a Supabase query, paging through PostgREST's 1000-row cap.
 *
 * Usage:
 *   const all = await fetchAll((from, to) =>
 *     supabase.from("usage_events").select("...").gte("date_utc", cutoff).range(from, to)
 *   );
 *
 * The query builder must accept (from, to) and apply .range(from, to). Returns
 * the concatenated rows array. Page size defaults to 1000 (PostgREST's max).
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety cap — don't loop forever on a broken query.
  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) {
      console.error("[fetchAll] error on page", page, error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Home page data
// ---------------------------------------------------------------------------

export async function getDashboardStats(days = 14): Promise<DashboardStats & { usingSeedData: boolean }> {
  if (!isServiceRoleConfigured()) {
    return buildSeedStats(days);
  }

  // P2: single Postgres RPC instead of paginating raw events through
  // Cloudflare Workers' 50-subrequest limit.
  try {
    const supabase = getSupabaseServerClient();
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("fn_dashboard_stats", { p_days: days });
    if (!rpcErr && rpcData) {
      const r = rpcData as any;
      return {
        totalEvents: r.totalEvents ?? 0,
        periodDays: r.periodDays ?? days,
        totalTokens: r.totalTokens ?? 0,
        totalCost: r.totalCost ?? null,
        dailyTotals: (r.dailyTotals ?? []) as DailyTotal[],
        topProjects: (r.topProjects ?? []) as ProjectTotals[],
        usingSeedData: false,
      };
    }
    // Fallback to legacy path on RPC failure
    console.error("[data.getDashboardStats] RPC failed, falling back:", rpcErr);
    const supabaseFallback = getSupabaseServerClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const events = await fetchAll<any>((from, to) =>
      supabaseFallback
        .from("usage_events")
        .select("date_utc,total_tokens,cost_usd,project_id")
        .gte("date_utc", cutoffDate)
        .order("date_utc", { ascending: true })
        .range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
    );

    if (events.length === 0) {
      return { ...emptyStats(days), usingSeedData: false };
    }

    const count = events.length;

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
    // P2: single-RPC path
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("fn_projects_summary", { p_days: days });
    if (!rpcErr && rpcData) {
      const r = rpcData as any;
      return {
        projects: (r.projects ?? []) as ProjectTotals[],
        totalEvents: r.totalEvents ?? 0,
        totalCost: r.totalCost ?? null,
        unattributedCount: r.unattributedCount ?? 0,
        usingSeedData: false,
      };
    }
    if (rpcErr) console.error("[fn_projects_summary] falling back:", rpcErr);

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

    const allEvents = await fetchAll<any>((from, to) =>
      supabase
        .from("usage_events")
        .select("project_id,total_tokens,cost_usd")
        .gte("date_utc", cutoffDate)
        .range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
    );
    const count = allEvents.length;
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
  projectIds: string[];
  projectNames: Map<string, string>;
  usingSeedData: boolean;
}

export async function getFilterOptions(): Promise<FilterOptions> {
  if (!isServiceRoleConfigured()) {
    const models = [...new Set(SEED_USAGE_EVENTS.map((e) => e.model))].sort();
    const userIds = SEED_USERS.map((u) => u.id);
    const userNames = new Map(SEED_USERS.map((u) => [u.id, u.display_name]));
    return { models, userIds, userNames, projectIds: [], projectNames: new Map(), usingSeedData: true };
  }

  try {
    const supabase = getSupabaseServerClient();
    const [eventRows, usersRes, projectsRes] = await Promise.all([
      // Paginated sweep so we don't miss low-volume models behind the 1000-row cap
      fetchAll<{ model: string }>((from, to) =>
        supabase.from("usage_events").select("model").range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
      ),
      supabase.from("users").select("id,display_name").is("deleted_at", null) as unknown as Promise<{ data: any[] | null }>,
      supabase.from("projects").select("id,display_name,client").is("deleted_at", null).order("display_name") as unknown as Promise<{ data: any[] | null }>,
    ]);

    const models = [...new Set(eventRows.map((e: any) => e.model))].sort() as string[];
    const users = (usersRes.data ?? []) as { id: string; display_name: string }[];
    const userIds = users.map((u) => u.id);
    const userNames = new Map(users.map((u) => [u.id, u.display_name]));
    const projects = (projectsRes.data ?? []) as { id: string; display_name: string; client: string | null }[];
    const projectIds = projects.map((p) => p.id);
    const projectNames = new Map(
      projects.map((p) => [p.id, p.client ? `${p.client} / ${p.display_name}` : p.display_name]),
    );

    return { models, userIds, userNames, projectIds, projectNames, usingSeedData: false };
  } catch {
    return { models: [], userIds: [], userNames: new Map(), projectIds: [], projectNames: new Map(), usingSeedData: false };
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
// Subscriptions summary (for /subscriptions page)
// ---------------------------------------------------------------------------

/**
 * Computes the window start timestamp given window_type and window_hours.
 * rolling_hours: now - window_hours
 * calendar_week: start of the current ISO week (Monday 00:00 UTC)
 * calendar_month: start of the current calendar month (1st 00:00 UTC)
 */
function windowStart(windowType: string, windowHours: number | null): string {
  const now = new Date();
  if (windowType === "rolling_hours" && windowHours != null) {
    return new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
  }
  if (windowType === "calendar_week") {
    // Monday = day 1; JS: 0=Sun
    const day = now.getUTCDay();
    const diff = (day === 0 ? 6 : day - 1); // days since Monday
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString();
  }
  if (windowType === "calendar_month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }
  // Fallback: 24h
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

export async function getSubscriptionsSummary(): Promise<{
  subscriptions: SubscriptionSummary[];
  usingSeedData: boolean;
}> {
  if (!isServiceRoleConfigured()) {
    return { subscriptions: [], usingSeedData: false };
  }

  try {
    const supabase = getSupabaseServerClient();

    // 1. Load all active subscriptions
    const { data: subs, error: subErr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("active", true)
      .order("created_at") as { data: any[] | null; error: any };

    if (subErr || !subs || subs.length === 0) {
      if (subErr) console.error("[data.getSubscriptionsSummary] subs error:", subErr);
      return { subscriptions: [], usingSeedData: false };
    }

    // 2. Load all quota_windows for these subscriptions
    const subIds = subs.map((s) => s.id);
    const { data: windows, error: winErr } = await supabase
      .from("quota_windows")
      .select("*")
      .in("subscription_id", subIds)
      .eq("active", true) as { data: any[] | null; error: any };

    if (winErr) {
      console.error("[data.getSubscriptionsSummary] windows error:", winErr);
    }
    const allWindows = (windows ?? []) as any[];

    // 3. Load 30-day usage events for all providers in one shot
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoffDate30 = cutoff30.toISOString().slice(0, 10);

    const providers = [...new Set(subs.map((s) => s.provider))];
    const allEvents = await fetchAll<any>((from, to) =>
      supabase
        .from("usage_events")
        .select("provider,total_tokens,cost_usd,captured_at")
        .in("provider", providers)
        .gte("date_utc", cutoffDate30)
        .range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
    );

    // 4. Compute per-provider 30d totals
    const by30 = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of allEvents) {
      const existing = by30.get(e.provider) ?? { tokens: 0, cost: null };
      by30.set(e.provider, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }

    // 5. For each window, compute tokens_in_window from the already-fetched events
    //    (we re-filter by captured_at >= windowStart in JS to avoid N+1 queries)
    const windowResults: QuotaWindowWithUsage[] = allWindows.map((w: any) => {
      const start = windowStart(w.window_type, w.window_hours);
      let tokens = 0;
      for (const e of allEvents) {
        if (e.provider === subs.find((s: any) => s.id === w.subscription_id)?.provider) {
          if (e.captured_at >= start) {
            tokens += e.total_tokens ?? 0;
          }
        }
      }
      return {
        id: w.id,
        subscription_id: w.subscription_id,
        window_label: w.window_label,
        window_type: w.window_type,
        window_hours: w.window_hours,
        tokens_in_window: tokens,
        notes: w.notes,
      };
    });

    // 6. Assemble
    const subscriptions: SubscriptionSummary[] = subs.map((s: any) => ({
      id: s.id,
      provider: s.provider,
      plan_name: s.plan_name,
      monthly_cost_usd: s.monthly_cost_usd,
      management_urls: s.management_urls ?? null,
      started_at: s.started_at ?? null,
      tokens_30d: by30.get(s.provider)?.tokens ?? 0,
      cost_30d: by30.get(s.provider)?.cost ?? null,
      windows: windowResults.filter((w) => w.subscription_id === s.id),
    } as any));

    return { subscriptions, usingSeedData: false };
  } catch (err) {
    console.error("[data.getSubscriptionsSummary] Unexpected error:", err);
    return { subscriptions: [], usingSeedData: false };
  }
}

// ---------------------------------------------------------------------------
// Quota windows (for /quota page) — all windows across all subscriptions
// ---------------------------------------------------------------------------

export interface QuotaWindowDetail extends QuotaWindowWithUsage {
  provider: string;
  plan_name: string;
  monthly_cost_usd: number | null;
  /** ms remaining until window resets (for rolling_hours windows); null otherwise */
  ms_until_reset: number | null;
  /** Latest percent_used from quota_observations (0-100); null if no observations yet */
  fillPct: number | null;
  /** ISO timestamp of latest quota observation (for staleness detection) */
  latest_observed_at: string | null;
}

export async function getQuotaWindowDetails(): Promise<{
  windows: QuotaWindowDetail[];
  usingSeedData: boolean;
}> {
  if (!isServiceRoleConfigured()) {
    return { windows: [], usingSeedData: false };
  }

  try {
    const supabase = getSupabaseServerClient();
    // P2: try the single-RPC path first; falls back if function not deployed
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("fn_quota_window_details");
    if (!rpcErr && Array.isArray(rpcData)) {
      return { windows: rpcData as QuotaWindowDetail[], usingSeedData: false };
    }
    if (rpcErr) console.error("[fn_quota_window_details] falling back:", rpcErr);

    const [{ data: subs }, { data: rawWindows }] = await Promise.all([
      supabase.from("subscriptions").select("id,provider,plan_name,monthly_cost_usd,management_urls,started_at").eq("active", true) as unknown as Promise<{ data: any[] | null }>,
      supabase.from("quota_windows").select("id,subscription_id,window_label,window_type,window_hours,notes").eq("active", true) as unknown as Promise<{ data: any[] | null }>,
    ]);

    if (!subs || !rawWindows) return { windows: [], usingSeedData: false };
    const subById = new Map<string, any>(subs.map((s) => [s.id, s]));

    const subscriptions = subs.map((s) => ({
      id: s.id,
      provider: s.provider,
      plan_name: s.plan_name,
      monthly_cost_usd: s.monthly_cost_usd,
      windows: rawWindows
        .filter((w) => w.subscription_id === s.id)
        .map((w) => ({
          id: w.id,
          subscription_id: w.subscription_id,
          window_label: w.window_label,
          window_type: w.window_type,
          window_hours: w.window_hours,
          tokens_in_window: 0,
          notes: w.notes,
        })),
    }));
    void subById;

    const usingSeedData = false;
    if (!subscriptions.length) return { windows: [], usingSeedData };

    const now = Date.now();

    const windows: QuotaWindowDetail[] = subscriptions.flatMap((sub) =>
      sub.windows.map((w) => {
        let ms_until_reset: number | null = null;
        if (w.window_type === "rolling_hours" && w.window_hours != null) {
          ms_until_reset = w.window_hours * 60 * 60 * 1000;
        }
        return {
          ...w,
          provider: sub.provider,
          plan_name: sub.plan_name,
          monthly_cost_usd: sub.monthly_cost_usd,
          ms_until_reset,
          fillPct: null,
          latest_observed_at: null,
        };
      })
    );

    // Attach latest percent_used from quota_observations
    if (windows.length > 0) {
      const supabase = getSupabaseServerClient();
      const windowIds = windows.map((w) => w.id);
      const { data: observations } = await supabase
        .from("quota_observations")
        .select("quota_window_id, percent_used, observed_at")
        .in("quota_window_id", windowIds)
        .order("observed_at", { ascending: false }) as { data: { quota_window_id: number; percent_used: number | null; observed_at: string }[] | null };

      if (observations && observations.length > 0) {
        const latestByWindow = new Map<number, { pct: number | null; observed_at: string }>();
        for (const obs of observations) {
          if (!latestByWindow.has(obs.quota_window_id)) {
            // percent_used is 0-100 in DB; WindowCard expects 0-1
            const pct = obs.percent_used != null ? obs.percent_used / 100 : null;
            latestByWindow.set(obs.quota_window_id, { pct, observed_at: obs.observed_at });
          }
        }
        for (const w of windows) {
          const latest = latestByWindow.get(w.id);
          if (latest) {
            w.fillPct = latest.pct;
            w.latest_observed_at = latest.observed_at;
          }
        }
      }
    }

    return { windows, usingSeedData };
  } catch (err) {
    console.error("[data.getQuotaWindowDetails] Unexpected error:", err);
    return { windows: [], usingSeedData: false };
  }
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
    const cutoffDate = days != null
      ? (() => { const c = new Date(); c.setDate(c.getDate() - days); return c.toISOString().slice(0, 10); })()
      : null;

    const data = await fetchAll<any>((from, to) => {
      let q = supabase
        .from("usage_events")
        .select("provider,model,input_tokens,output_tokens,total_tokens,cost_usd");
      if (cutoffDate) q = q.gte("date_utc", cutoffDate);
      return q.range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>;
    });

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

// ---------------------------------------------------------------------------
// Wrap stats (2026 YTD) — used by /wrap page
// ---------------------------------------------------------------------------

import type { WrapStats } from "@/app/api/wrap/route";

const WRAP_YEAR = 2026;
const WRAP_CUTOFF = `${WRAP_YEAR}-01-01`;
const WRAP_MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function getWrapStats(): Promise<WrapStats | null> {
  if (!isServiceRoleConfigured()) return null;

  try {
    const supabase = getSupabaseServerClient();

    const rows = await fetchAll<any>((from, to) =>
      supabase
        .from("usage_events")
        .select("date_utc,provider,model,total_tokens,cost_usd,project_id")
        .gte("date_utc", WRAP_CUTOFF)
        .order("date_utc", { ascending: true })
        .range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
    );
    const count = rows.length;
    const hasCost = rows.some((r) => r.cost_usd != null);
    let totalTokens = 0;
    let totalCost: number | null = null;

    const byModel = new Map<string, number>();
    const byMonth = new Map<string, { tokens: number; cost: number | null }>();
    const byDay = new Map<string, number>();
    const byProvider = new Map<string, { tokens: number; cost: number | null }>();
    const byProject = new Map<string, { tokens: number; cost: number | null }>();

    for (const r of rows) {
      const tokens: number = r.total_tokens ?? 0;
      const cost: number | null = r.cost_usd ?? null;
      totalTokens += tokens;
      if (hasCost) totalCost = (totalCost ?? 0) + (cost ?? 0);

      byModel.set(r.model, (byModel.get(r.model) ?? 0) + tokens);

      const month = (r.date_utc as string).slice(0, 7);
      const em = byMonth.get(month) ?? { tokens: 0, cost: null };
      byMonth.set(month, { tokens: em.tokens + tokens, cost: cost != null ? (em.cost ?? 0) + cost : em.cost });

      byDay.set(r.date_utc, (byDay.get(r.date_utc) ?? 0) + tokens);

      const prov: string = r.provider ?? "other";
      const ep = byProvider.get(prov) ?? { tokens: 0, cost: null };
      byProvider.set(prov, { tokens: ep.tokens + tokens, cost: cost != null ? (ep.cost ?? 0) + cost : ep.cost });

      if (r.project_id) {
        const ej = byProject.get(r.project_id) ?? { tokens: 0, cost: null };
        byProject.set(r.project_id, { tokens: ej.tokens + tokens, cost: cost != null ? (ej.cost ?? 0) + cost : ej.cost });
      }
    }

    let topModel: string | null = null;
    let topModelTokens = 0;
    for (const [m, t] of byModel) { if (t > topModelTokens) { topModelTokens = t; topModel = m; } }

    let topMonthKey: string | null = null;
    let topMonthTokens = 0;
    for (const [m, v] of byMonth) { if (v.tokens > topMonthTokens) { topMonthTokens = v.tokens; topMonthKey = m; } }
    const topMonth = topMonthKey ? WRAP_MONTH_LABELS[parseInt(topMonthKey.slice(5, 7), 10) - 1] ?? null : null;

    let peakDay: string | null = null;
    let peakDayTokens = 0;
    for (const [d, t] of byDay) { if (t > peakDayTokens) { peakDayTokens = t; peakDay = d; } }

    const sortedProviders = Array.from(byProvider.entries()).sort(([, a], [, b]) => b.tokens - a.tokens);
    const providerBreakdown = sortedProviders.map(([provider, v]) => ({
      provider,
      tokens: v.tokens,
      cost: v.cost,
      pct: totalTokens > 0 ? Math.round((v.tokens / totalTokens) * 100) : 0,
    }));

    const topProjectIds = Array.from(byProject.entries())
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .slice(0, 5)
      .map(([id]) => id);

    let topProjects: WrapStats["topProjects"] = [];
    if (topProjectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id,slug,display_name,client")
        .in("id", topProjectIds) as { data: any[] | null };
      topProjects = ((projectRows ?? []) as any[]).map((p) => ({
        id: p.id,
        slug: p.slug,
        display_name: p.display_name,
        client: p.client,
        tokens: byProject.get(p.id)?.tokens ?? 0,
        cost: byProject.get(p.id)?.cost ?? null,
      })).sort((a, b) => b.tokens - a.tokens);
    }

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthlyTotals: WrapStats["monthlyTotals"] = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${WRAP_YEAR}-${String(m).padStart(2, "0")}`;
      if (key > currentMonth) break;
      const v = byMonth.get(key);
      monthlyTotals.push({ month: key, label: WRAP_MONTH_LABELS[m - 1], tokens: v?.tokens ?? 0, cost: v?.cost ?? null });
    }

    return {
      year: WRAP_YEAR,
      totalTokens,
      totalCost: hasCost ? totalCost : null,
      totalEvents: count ?? rows.length,
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
  } catch (err) {
    console.error("[data.getWrapStats] Unexpected error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reconcile data — used by /reconcile page
// ---------------------------------------------------------------------------

import type { UnattributedGroup } from "@/app/api/reconcile/route";

export async function getUnattributedGroups(): Promise<UnattributedGroup[]> {
  if (!isServiceRoleConfigured()) return [];

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("usage_events")
      .select("date_utc,model,capture_method,total_tokens,cost_usd")
      .is("project_id", null)
      .order("date_utc", { ascending: false })
      .limit(500) as { data: any[] | null; error: any };

    if (error) {
      console.error("[data.getUnattributedGroups] Supabase error:", error);
      return [];
    }

    const map = new Map<string, UnattributedGroup>();
    for (const r of data ?? []) {
      const key = `${r.date_utc}|${r.model}|${r.capture_method}`;
      const existing = map.get(key);
      if (existing) {
        existing.event_count += 1;
        existing.total_tokens += r.total_tokens ?? 0;
        if (r.cost_usd != null) existing.total_cost = (existing.total_cost ?? 0) + r.cost_usd;
      } else {
        map.set(key, {
          date_utc: r.date_utc,
          model: r.model,
          capture_method: r.capture_method,
          event_count: 1,
          total_tokens: r.total_tokens ?? 0,
          total_cost: r.cost_usd ?? null,
        });
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.date_utc.localeCompare(a.date_utc))
      .slice(0, 100);
  } catch (err) {
    console.error("[data.getUnattributedGroups] Unexpected error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Users summary (for /users page)
// ---------------------------------------------------------------------------

export async function getUsersSummary(days = 30): Promise<{
  users: UserSummaryRow[];
  totalHuman: number;
  totalService: number;
  totalTokens: number;
  usingSeedData: boolean;
}> {
  if (!isServiceRoleConfigured()) {
    // Seed fallback — derive from SEED_USERS + SEED_USAGE_EVENTS
    const byUser = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of SEED_USAGE_EVENTS) {
      const existing = byUser.get(e.user_id) ?? { tokens: 0, cost: null };
      byUser.set(e.user_id, {
        tokens: existing.tokens + e.total_tokens,
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }
    const users: UserSummaryRow[] = SEED_USERS.map((u) => ({
      id: u.id,
      slug: u.slug,
      display_name: u.display_name,
      account_type: u.account_type,
      email: u.email,
      default_timezone: u.default_timezone,
      total_tokens: byUser.get(u.id)?.tokens ?? 0,
      cost_usd: byUser.get(u.id)?.cost ?? null,
    })).sort((a, b) => b.total_tokens - a.total_tokens);

    const totalHuman = users.filter((u) => u.account_type === "human").length;
    const totalService = users.filter((u) => u.account_type === "service").length;
    const totalTokens = users.reduce((s, u) => s + u.total_tokens, 0);
    return { users, totalHuman, totalService, totalTokens, usingSeedData: true };
  }

  try {
    const supabase = getSupabaseServerClient();

    // Fetch all active users
    const { data: userRows, error: userErr } = await supabase
      .from("users")
      .select("id,slug,display_name,account_type,email,default_timezone")
      .is("deleted_at", null)
      .order("display_name") as { data: any[] | null; error: any };

    if (userErr || !userRows) {
      console.error("[data.getUsersSummary] Users error:", userErr);
      return { users: [], totalHuman: 0, totalService: 0, totalTokens: 0, usingSeedData: false };
    }

    // Fetch usage events for the period
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const userIds = (userRows as any[]).map((u) => u.id);
    const events = await fetchAll<any>((from, to) =>
      supabase
        .from("usage_events")
        .select("user_id,total_tokens,cost_usd")
        .in("user_id", userIds)
        .gte("date_utc", cutoffDate)
        .range(from, to) as unknown as Promise<{ data: any[] | null; error: any }>,
    );

    const byUser = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of events as any[]) {
      if (!e.user_id) continue;
      const existing = byUser.get(e.user_id) ?? { tokens: 0, cost: null };
      byUser.set(e.user_id, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }

    const users: UserSummaryRow[] = (userRows as any[]).map((u) => ({
      id: u.id,
      slug: u.slug,
      display_name: u.display_name,
      account_type: u.account_type as "human" | "service",
      email: u.email,
      default_timezone: u.default_timezone,
      total_tokens: byUser.get(u.id)?.tokens ?? 0,
      cost_usd: byUser.get(u.id)?.cost ?? null,
    })).sort((a, b) => b.total_tokens - a.total_tokens);

    const totalHuman = users.filter((u) => u.account_type === "human").length;
    const totalService = users.filter((u) => u.account_type === "service").length;
    const totalTokens = users.reduce((s, u) => s + u.total_tokens, 0);

    return { users, totalHuman, totalService, totalTokens, usingSeedData: false };
  } catch (err) {
    console.error("[data.getUsersSummary] Unexpected error:", err);
    return { users: [], totalHuman: 0, totalService: 0, totalTokens: 0, usingSeedData: false };
  }
}

export async function getProjectsForSelect(): Promise<ProjectTotals[]> {
  if (!isServiceRoleConfigured()) return [];

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id,slug,display_name,client")
      .is("deleted_at", null)
      .order("display_name") as { data: any[] | null; error: any };

    if (error) {
      console.error("[data.getProjectsForSelect] Supabase error:", error);
      return [];
    }

    return ((data ?? []) as any[]).map((p) => ({
      id: p.id,
      slug: p.slug,
      display_name: p.display_name,
      client: p.client,
      totalTokens: 0,
      totalCost: null,
    }));
  } catch (err) {
    console.error("[data.getProjectsForSelect] Unexpected error:", err);
    return [];
  }
}
