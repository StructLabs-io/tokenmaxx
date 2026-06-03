/**
 * /wrap — Year-in-review (2026 YTD)
 *
 * Server component: fetches wrap stats directly from Supabase via lib/data.ts.
 * Styled as a "Spotify Wrapped"-style shareable stats page.
 */

import { getWrapStats, getWrapPeriodBuckets } from "@/lib/data";
import { formatTokens, formatTokensExact, formatCost, formatDateShort, formatTokensCompact, formatCostCompact } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { UsageBarChart } from "@/components/charts/usage-bar";

export const dynamic = "force-dynamic";

async function getPeriodStats(period: "year" | "month" | "week") {
  try {
    const { getSupabaseServerClient, isServiceRoleConfigured } = await import("@/lib/supabase/client");
    if (!isServiceRoleConfigured()) return null;
    const sb = getSupabaseServerClient();
    const { data, error } = await (sb as any).rpc("fn_wrap_period_stats", { p_period: period });
    if (error) return null;
    return data;
  } catch { return null; }
}

export default async function WrapPage({ searchParams }: { searchParams?: Promise<{ period?: string }> }) {
  const sp = (await searchParams) ?? {};
  const period = (sp.period === "month" || sp.period === "week" ? sp.period : "year") as "year" | "month" | "week";
  const [stats, periodStats, periodBuckets] = await Promise.all([
    getWrapStats(),
    period === "year" ? Promise.resolve(null) : getPeriodStats(period),
    period !== "year" ? getWrapPeriodBuckets(period) : Promise.resolve(null),
  ]);

  if (!stats) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">2026 Wrapped</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Supabase is not configured — no data available.
        </p>
      </div>
    );
  }

  const {
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
  } = stats;

  // Bar chart data — use period-specific daily buckets when toggled to month/week;
  // fall back to YTD monthly data for the year view.
  const barData = periodBuckets && periodBuckets.buckets.length > 0
    ? periodBuckets.buckets
    : monthlyTotals.map((m) => ({ label: m.label, tokens: m.tokens }));

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {year} Wrapped
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your AI usage — year to date
          </p>
        </div>
        {/* §9.2 — calendar-month / calendar-week views (per OQ #9). */}
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs bg-muted/40">
          {(["year", "month", "week"] as const).map((p) => (
            <a
              key={p}
              href={p === "year" ? "/wrap" : `/wrap?period=${p}`}
              className={
                period === p
                  ? "px-2.5 py-1 rounded bg-background shadow-sm"
                  : "px-2.5 py-1 rounded text-muted-foreground hover:text-foreground"
              }
            >
              {p === "year" ? "YTD" : p === "month" ? "This month" : "This week"}
            </a>
          ))}
        </div>
      </div>

      {periodStats && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="px-5 py-4">
            <div className="text-xs text-muted-foreground mb-2">
              {periodStats.from_date} → {periodStats.to_date} (calendar {period})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Tokens</div>
                <div className="text-xl font-semibold tabular-nums" title={formatTokensExact(Number(periodStats.totalTokens) || 0)}>{formatTokens(Number(periodStats.totalTokens) || 0)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cost</div>
                <div className="text-xl font-semibold tabular-nums">{periodStats.totalCost != null ? formatCost(Number(periodStats.totalCost)) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Events</div>
                <div className="text-xl font-semibold tabular-nums">{Number(periodStats.totalEvents).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Top model</div>
                <div className="text-sm font-medium font-mono truncate">{periodStats.topModel ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="bg-primary/10 border-primary/20">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardDescription className="text-xs text-primary/70 uppercase tracking-wide font-medium">
              Total tokens
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-hidden">
            <p className="text-3xl font-black tabular-nums leading-none truncate" title={formatTokensExact(totalTokens)}>
              {formatTokensCompact(totalTokens)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">generated in {year}</p>
          </CardContent>
        </Card>

        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardDescription className="text-xs text-emerald-400/80 uppercase tracking-wide font-medium">
              Total spend
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-hidden">
            <p
              className="text-3xl font-black tabular-nums leading-none truncate"
              title={totalCost != null ? formatCost(totalCost) : undefined}
            >
              {totalCost != null ? formatCostCompact(totalCost) : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalCost == null ? "pricing pending" : "USD"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-violet-500/10 border-violet-500/20">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardDescription className="text-xs text-violet-400/80 uppercase tracking-wide font-medium">
              Total events
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-hidden">
            <p className="text-3xl font-black tabular-nums leading-none truncate">
              {totalEvents.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">API calls captured</p>
          </CardContent>
        </Card>

        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardDescription className="text-xs text-amber-400/80 uppercase tracking-wide font-medium">
              Peak day
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-hidden">
            <p className="text-3xl font-black tabular-nums leading-none truncate" title={formatTokensExact(peakDayTokens)}>
              {formatTokensCompact(peakDayTokens)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {peakDay ? formatDateShort(peakDay) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Second row: top model + top month */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-1">
            <CardDescription className="text-xs uppercase tracking-wide font-medium">
              Top model
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold truncate">{topModel ?? "—"}</p>
            <p className="text-sm text-muted-foreground mt-0.5 tabular-nums" title={formatTokensExact(topModelTokens)}>
              {formatTokens(topModelTokens)} tokens
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-1">
            <CardDescription className="text-xs uppercase tracking-wide font-medium">
              Most active month
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xl font-bold">{topMonth ?? "—"}</p>
            <p className="text-sm text-muted-foreground mt-0.5 tabular-nums" title={formatTokensExact(topMonthTokens)}>
              {formatTokens(topMonthTokens)} tokens
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly bar chart */}
      <Card>
        <CardHeader className="px-6 pt-5 pb-2">
          <CardTitle className="text-sm font-medium">Month-by-month token volume</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <UsageBarChart data={barData} height={180} />
        </CardContent>
      </Card>

      {/* Provider breakdown */}
      {providerBreakdown.length > 0 && (
        <Card>
          <CardHeader className="px-6 pt-5 pb-2">
            <CardTitle className="text-sm font-medium">By provider</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-4 space-y-3">
            {providerBreakdown.map((p) => (
              <div key={p.provider} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium capitalize">{p.provider}</span>
                  <span className="tabular-nums text-muted-foreground" title={formatTokensExact(p.tokens)}>
                    {formatTokens(p.tokens)} · {p.pct}%
                    {p.cost != null && ` · ${formatCost(p.cost)}`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Top 5 projects */}
      {topProjects.length > 0 && (
        <Card>
          <CardHeader className="px-6 pt-5 pb-2">
            <CardTitle className="text-sm font-medium">Top projects</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-4 space-y-3">
            {topProjects.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="text-2xl font-black text-muted-foreground w-6 shrink-0 tabular-nums">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.display_name}</p>
                  {p.client && (
                    <p className="text-xs text-muted-foreground">{p.client}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium tabular-nums" title={formatTokensExact(p.tokens)}>
                    {formatTokens(p.tokens)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {p.cost != null ? formatCost(p.cost) : "—"}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
