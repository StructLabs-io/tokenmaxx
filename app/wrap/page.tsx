/**
 * /wrap — Year-in-review (2026 YTD)
 *
 * Server component: fetches wrap stats directly from Supabase via lib/data.ts.
 * Styled as a "Spotify Wrapped"-style shareable stats page.
 */

import { getWrapStats } from "@/lib/data";
import { formatTokens, formatCost, formatDateShort, formatTokensCompact, formatCostCompact } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { UsageBarChart } from "@/components/charts/usage-bar";

export const dynamic = "force-dynamic";

export default async function WrapPage() {
  const stats = await getWrapStats();

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

  // Bar chart data
  const barData = monthlyTotals.map((m) => ({
    label: m.label,
    tokens: m.tokens,
  }));

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
        {/* §9.2 — period toggle. Currently shows YTD; month/week views to wire
            after we agree on the slice (calendar month/week per OQ #9 = yes).
            These links navigate to the dashboard which has the underlying data. */}
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs bg-muted/40">
          <span className="px-2.5 py-1 rounded bg-background shadow-sm">YTD</span>
          <a href="/?range=30D" className="px-2.5 py-1 rounded text-muted-foreground hover:text-foreground">This month</a>
          <a href="/?range=7D" className="px-2.5 py-1 rounded text-muted-foreground hover:text-foreground">This week</a>
        </div>
      </div>

      {/* Hero stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="bg-primary/10 border-primary/20">
          <CardHeader className="pb-1 px-4 pt-4">
            <CardDescription className="text-xs text-primary/70 uppercase tracking-wide font-medium">
              Total tokens
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-hidden">
            <p className="text-3xl font-black tabular-nums leading-none truncate" title={formatTokens(totalTokens)}>
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
            <p className="text-3xl font-black tabular-nums leading-none truncate" title={formatTokens(peakDayTokens)}>
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
            <p className="text-sm text-muted-foreground mt-0.5 tabular-nums">
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
            <p className="text-sm text-muted-foreground mt-0.5 tabular-nums">
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
                  <span className="tabular-nums text-muted-foreground">
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
                  <p className="text-sm font-medium tabular-nums">
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
