/**
 * / -- Dashboard home
 *
 * Shows: Today's tokens, this week, top projects, quota window summary.
 * Data source: seed data until Supabase is wired (v0.2).
 */

import {
  SEED_USAGE_EVENTS,
  SEED_QUOTA_WINDOWS,
  SEED_QUOTA_FILLS,
  seedCostByProject,
  seedDailyTotals,
} from "@/lib/seed-data";
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
import { UsageLineChart } from "@/components/charts/usage-line";

export default function DashboardPage() {
  const events = SEED_USAGE_EVENTS;
  const dailyTotals = seedDailyTotals(events);
  const projectCosts = seedCostByProject(events).slice(0, 5);

  const totalTokens = events.reduce((s, e) => s + e.total_tokens, 0);
  const totalCost = events.reduce((s, e) => s + e.cost_usd, 0);

  // Use last 7 days from seed (last 7 daily buckets)
  const last7 = dailyTotals.slice(-7);
  const weekTokens = last7.reduce((s, d) => s + d.tokens, 0);
  const weekCost = last7.reduce((s, d) => s + d.cost, 0);

  // "Today" -- last day in seed
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
        <Badge variant="secondary" className="text-xs">
          Seed data mode
        </Badge>
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
              {formatCost(today?.cost ?? 0)} cost
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
              {formatCost(weekCost)} cost
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total tokens (14d seed)</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {formatTokens(totalTokens)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {events.length} events
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total cost (14d seed)</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">
              {formatCost(totalCost)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">USD</p>
          </CardContent>
        </Card>
      </div>

      {/* Usage sparkline */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">
            14-day token trend
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-2">
          <UsageLineChart data={dailyTotals} metric="tokens" height={180} />
        </CardContent>
      </Card>

      {/* Bottom row: top projects + quota windows */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Top projects */}
        <Card>
          <CardHeader className="px-6">
            <CardTitle className="text-sm font-medium">Top projects</CardTitle>
          </CardHeader>
          <CardContent className="px-6">
            <div className="space-y-3">
              {projectCosts.map(({ project, totalCost: pc, totalTokens: pt }) => (
                <div key={project.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: project.color ?? "#6366f1" }}
                    />
                    <span className="text-sm truncate max-w-[140px]">
                      {project.name}
                    </span>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="text-sm font-medium tabular-nums">
                      {formatCost(pc)}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatTokens(pt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quota windows */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium px-0.5">Quota windows</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SEED_QUOTA_WINDOWS.map((qw) => (
              <WindowCard
                key={qw.id}
                window={qw}
                fillPct={SEED_QUOTA_FILLS[qw.id] ?? 0}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
