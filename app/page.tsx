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
import { WindowCard } from "@/components/quota/window-card";
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

      {/* Bottom row: top projects + quota windows */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top projects */}
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

        {/* Quota windows — Claude left, Codex right, live from quota_observations */}
        {quotaWindows.length > 0 && (() => {
          const claude = quotaWindows.filter((w) => w.provider === "anthropic");
          const codex = quotaWindows.filter((w) => w.provider === "openai-codex");
          // Stale = no observation OR last observation > 90 min old (cron is 30 min)
          const STALE_MS = 90 * 60 * 1000;
          const isStale = (ws: typeof codex) =>
            ws.length > 0 && ws.some((w) =>
              w.latest_observed_at == null ||
              Date.now() - new Date(w.latest_observed_at).getTime() > STALE_MS,
            );
          const codexStale = isStale(codex);
          return (
            <div className="space-y-3">
              <h2 className="text-sm font-medium px-0.5">Quota windows</h2>
              {codexStale && (
                <p className="text-xs rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 px-3 py-1.5">
                  ⚠ Codex quota data is stale. Refresh <code className="font-mono text-[11px]">CHATGPT_SESSION_TOKEN_0/1</code> in <code className="font-mono text-[11px]">shared/.env</code>.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Claude column */}
                {claude.length > 0 && (
                  <Card>
                    <CardHeader className="px-5 pt-4 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#cc785c] text-white text-sm font-bold">C</span>
                        <CardTitle className="text-sm font-semibold">Anthropic Claude</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-2">
                      {claude.map((qw) => (
                        <WindowCard
                          key={qw.id}
                          window={{
                            id: qw.id, subscription_id: qw.subscription_id,
                            window_label: qw.window_label, window_type: qw.window_type,
                            window_hours: qw.window_hours, reset_anchor: null,
                            active: true, notes: qw.notes,
                            created_at: new Date(0).toISOString(),
                          }}
                          fillPct={qw.fillPct ?? null}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}
                {/* Codex column */}
                {codex.length > 0 && (
                  <Card>
                    <CardHeader className="px-5 pt-4 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black text-white text-sm font-bold">O</span>
                        <CardTitle className="text-sm font-semibold">OpenAI Codex</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-2">
                      {codex.map((qw) => (
                        <WindowCard
                          key={qw.id}
                          window={{
                            id: qw.id, subscription_id: qw.subscription_id,
                            window_label: qw.window_label, window_type: qw.window_type,
                            window_hours: qw.window_hours, reset_anchor: null,
                            active: true, notes: qw.notes,
                            created_at: new Date(0).toISOString(),
                          }}
                          fillPct={qw.fillPct ?? null}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
