/**
 * / -- Dashboard home
 *
 * Server Component -- fetches live data from Supabase prod via lib/data.ts.
 * Falls back to seed data automatically when SUPABASE_SERVICE_ROLE_KEY is not set.
 */

import { getDashboardStats, getQuotaWindowDetails } from "@/lib/data";
import { formatTokens, formatCost } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QuotaSection } from "@/components/quota/quota-section";
import { TokenTrendCard } from "@/components/dashboard/token-trend-card";
import type { DailyTotal } from "@/lib/supabase/types";
import { LiveTicker } from "@/components/realtime/live-ticker";


export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [stats, { windows: quotaWindows }] = await Promise.all([
    getDashboardStats(14),
    getQuotaWindowDetails(),
  ]);

  const { dailyTotals, topProjects, totalTokens, totalCost, totalEvents, usingSeedData } = stats;

  // Chart needs { date, tokens, cost } shape
  const chartData = dailyTotals.map(d => ({ ...d, cost: d.cost ?? 0 }));

  const last7 = dailyTotals.slice(-7);
  const weekTokens = last7.reduce((s, d) => s + d.tokens, 0);
  const weekCost = last7.some((d) => d.cost != null)
    ? last7.reduce((s, d) => s + (d.cost ?? 0), 0)
    : null;

  const today = dailyTotals[dailyTotals.length - 1];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI usage overview
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveTicker />
          <Badge variant={usingSeedData ? "secondary" : "outline"} className="text-xs">
            {usingSeedData ? "Seed data" : `${totalEvents.toLocaleString()} events`}
          </Badge>
        </div>
      </div>

      {/* Quota windows — moved to top per feedback v0.4 §2.1 */}
      <QuotaSection
        windows={quotaWindows.map((qw) => ({
          id: qw.id,
          subscription_id: qw.subscription_id,
          window_label: qw.window_label,
          window_type: qw.window_type,
          window_hours: qw.window_hours,
          notes: qw.notes,
          provider: qw.provider,
          fillPct: qw.fillPct ?? null,
          latest_observed_at: qw.latest_observed_at ?? null,
        }))}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Today&apos;s tokens</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {formatTokens(today?.tokens ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {today?.cost != null ? formatCost(today.cost) : "$ pending"} cost
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>This week</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {formatTokens(weekTokens)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {weekCost != null ? formatCost(weekCost) : "$ pending"} cost
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total tokens ({stats.periodDays}d)</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {formatTokens(totalTokens)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {totalEvents.toLocaleString()} events
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total cost ({stats.periodDays}d)</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {totalCost != null ? formatCost(totalCost) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {totalCost == null ? "$ pending pricing data" : "USD"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Usage trend — bar chart with 1D/3D/7D/14D/30D/Custom toggles */}
      <TokenTrendCard
        initialBuckets={chartData.map((d) => ({ label: d.date, tokens: d.tokens, cost: d.cost ?? 0 }))}
      />

      {/* Top projects (now full-width since quota moved up) */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">Top projects</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          {topProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attributed events yet.</p>
          ) : (
            <div className="space-y-3">
              {topProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                    <span className="text-sm truncate max-w-[140px]">
                      {p.display_name}
                    </span>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-sm font-medium tabular-nums">
                      {p.totalCost != null ? formatCost(p.totalCost) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatTokens(p.totalTokens)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
