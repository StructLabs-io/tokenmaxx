/**
 * GET /api/stats
 *
 * Returns dashboard summary stats from prod Supabase.
 * Uses service role key (server-only) -- bypasses RLS.
 *
 * Query params:
 *   days=14  (default 14, max 90)
 *
 * Response: DashboardStats JSON
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import type { DashboardStats, DailyTotal, ProjectTotals } from "@/lib/supabase/types";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

export async function GET(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(
    parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS,
    MAX_DAYS
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  try {
    const supabase = getSupabaseServerClient();

    // Fetch raw events for the period (select only columns we need for aggregation)
    const { data: events, error, count } = await supabase
      .from("usage_events")
      .select("date_utc,total_tokens,cost_usd,project_id", { count: "exact" })
      .gte("date_utc", cutoffDate)
      .order("date_utc", { ascending: true });

    if (error) {
      console.error("[/api/stats] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return Response.json(emptyStats(days));
    }

    const eventsTyped = events as any[];

    // Aggregate daily totals
    const byDate = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of eventsTyped) {
      const existing = byDate.get(e.date_utc) ?? { tokens: 0, cost: null };
      byDate.set(e.date_utc, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null
          ? (existing.cost ?? 0) + e.cost_usd
          : existing.cost,
      });
    }

    const dailyTotals: DailyTotal[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { tokens, cost }]) => ({ date, tokens, cost }));

    // Aggregate by project
    const byProject = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of eventsTyped) {
      if (!e.project_id) continue;
      const existing = byProject.get(e.project_id) ?? { tokens: 0, cost: null };
      byProject.set(e.project_id, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null
          ? (existing.cost ?? 0) + e.cost_usd
          : existing.cost,
      });
    }

    // Fetch projects for display names (only ones we have events for)
    const projectIds = Array.from(byProject.keys());
    let topProjects: ProjectTotals[] = [];

    if (projectIds.length > 0) {
      const { data: projects } = await supabase
        .from("projects")
        .select("id,slug,display_name,client")
        .in("id", projectIds) as { data: any[] | null };

      topProjects = ((projects ?? []) as any[])
        .map((p) => {
          const totals = byProject.get(p.id);
          return {
            id: p.id,
            slug: p.slug,
            display_name: p.display_name,
            client: p.client,
            totalTokens: totals?.tokens ?? 0,
            totalCost: totals?.cost ?? null,
          };
        })
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 5);
    }

    const totalTokens = eventsTyped.reduce((s, e) => s + (e.total_tokens ?? 0), 0);
    const hasCost = eventsTyped.some((e) => e.cost_usd != null);
    const totalCost = hasCost
      ? eventsTyped.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
      : null;

    const stats: DashboardStats = {
      totalEvents: count ?? eventsTyped.length,
      periodDays: days,
      totalTokens,
      totalCost,
      dailyTotals,
      topProjects,
    };

    return Response.json(stats, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/stats] Unexpected error:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
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
