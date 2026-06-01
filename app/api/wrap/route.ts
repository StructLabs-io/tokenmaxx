/**
 * GET /api/wrap
 *
 * Year-in-review stats for 2026 YTD.
 * Returns WrapStats JSON for the /wrap page and any external consumers.
 *
 * No query params — always returns 2026 YTD.
 */

import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import type { ProviderBreakdown, WrapProject, MonthlyTotal, WrapStats } from "@/lib/supabase/types";

export type { ProviderBreakdown, WrapProject, MonthlyTotal, WrapStats };

const YEAR = 2026;
const CUTOFF = `${YEAR}-01-01`;

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function GET() {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  try {
    const supabase = getSupabaseServerClient();

    // Single wide select — compute everything in-process to minimise round-trips
    const { data: events, error, count } = await supabase
      .from("usage_events")
      .select(
        "date_utc,provider,model,total_tokens,cost_usd,project_id",
        { count: "exact" }
      )
      .gte("date_utc", CUTOFF)
      .order("date_utc", { ascending: true }) as { data: any[] | null; error: any; count: number | null };

    if (error) {
      console.error("[/api/wrap] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = events ?? [];

    // Totals
    let totalTokens = 0;
    let totalCost: number | null = null;
    const hasCost = rows.some((r) => r.cost_usd != null);

    // Per-model
    const byModel = new Map<string, number>();
    // Per-month
    const byMonth = new Map<string, { tokens: number; cost: number | null }>();
    // Per-day
    const byDay = new Map<string, number>();
    // Per-provider
    const byProvider = new Map<string, { tokens: number; cost: number | null }>();
    // Per-project
    const byProject = new Map<string, { tokens: number; cost: number | null }>();

    for (const r of rows) {
      const tokens: number = r.total_tokens ?? 0;
      const cost: number | null = r.cost_usd ?? null;

      totalTokens += tokens;
      if (hasCost) totalCost = (totalCost ?? 0) + (cost ?? 0);

      // model
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + tokens);

      // month e.g. "2026-05"
      const month = (r.date_utc as string).slice(0, 7);
      const existingMonth = byMonth.get(month) ?? { tokens: 0, cost: null };
      byMonth.set(month, {
        tokens: existingMonth.tokens + tokens,
        cost: cost != null ? (existingMonth.cost ?? 0) + cost : existingMonth.cost,
      });

      // day
      byDay.set(r.date_utc, (byDay.get(r.date_utc) ?? 0) + tokens);

      // provider — normalise
      const provider: string = r.provider ?? "other";
      const existingProv = byProvider.get(provider) ?? { tokens: 0, cost: null };
      byProvider.set(provider, {
        tokens: existingProv.tokens + tokens,
        cost: cost != null ? (existingProv.cost ?? 0) + cost : existingProv.cost,
      });

      // project
      if (r.project_id) {
        const existingProj = byProject.get(r.project_id) ?? { tokens: 0, cost: null };
        byProject.set(r.project_id, {
          tokens: existingProj.tokens + tokens,
          cost: cost != null ? (existingProj.cost ?? 0) + cost : existingProj.cost,
        });
      }
    }

    // Top model
    let topModel: string | null = null;
    let topModelTokens = 0;
    for (const [model, t] of byModel) {
      if (t > topModelTokens) { topModelTokens = t; topModel = model; }
    }

    // Top month
    let topMonthKey: string | null = null;
    let topMonthTokens = 0;
    for (const [m, v] of byMonth) {
      if (v.tokens > topMonthTokens) { topMonthTokens = v.tokens; topMonthKey = m; }
    }
    const topMonth = topMonthKey
      ? MONTH_LABELS[parseInt(topMonthKey.slice(5, 7), 10) - 1] ?? null
      : null;

    // Peak day
    let peakDay: string | null = null;
    let peakDayTokens = 0;
    for (const [d, t] of byDay) {
      if (t > peakDayTokens) { peakDayTokens = t; peakDay = d; }
    }

    // Provider breakdown (sorted by tokens desc)
    const sortedProviders = Array.from(byProvider.entries())
      .sort(([, a], [, b]) => b.tokens - a.tokens);
    const providerBreakdown: ProviderBreakdown[] = sortedProviders.map(([provider, v]) => ({
      provider,
      tokens: v.tokens,
      cost: v.cost,
      pct: totalTokens > 0 ? Math.round((v.tokens / totalTokens) * 100) : 0,
    }));

    // Top 5 projects — need display_name, fetch from projects table
    const topProjectIds = Array.from(byProject.entries())
      .sort(([, a], [, b]) => b.tokens - a.tokens)
      .slice(0, 5)
      .map(([id]) => id);

    let topProjects: WrapProject[] = [];
    if (topProjectIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("id,slug,display_name,client")
        .in("id", topProjectIds) as { data: any[] | null };

      topProjects = (projectRows ?? []).map((p: any) => ({
        id: p.id,
        slug: p.slug,
        display_name: p.display_name,
        client: p.client,
        tokens: byProject.get(p.id)?.tokens ?? 0,
        cost: byProject.get(p.id)?.cost ?? null,
      })).sort((a, b) => b.tokens - a.tokens);
    }

    // Monthly totals array — all 12 months of YEAR, zero-fill missing
    const monthlyTotals: MonthlyTotal[] = [];
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    for (let m = 1; m <= 12; m++) {
      const key = `${YEAR}-${String(m).padStart(2, "0")}`;
      if (key > currentMonth) break; // don't show future months
      const v = byMonth.get(key);
      monthlyTotals.push({
        month: key,
        label: MONTH_LABELS[m - 1],
        tokens: v?.tokens ?? 0,
        cost: v?.cost ?? null,
      });
    }

    const stats: WrapStats = {
      year: YEAR,
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

    return Response.json(stats, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/wrap] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
