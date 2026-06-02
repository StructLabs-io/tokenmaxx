/**
 * /usage -- Filterable time-series of usage_events
 *
 * Server component: fetches initial 14D bucket totals + filter options.
 * Client component drives the bar chart + paginated events table; both
 * re-fetch from /api/usage-trend and /api/events when the timeframe or
 * filters change, so the data the chart shows always matches the window
 * (rather than being capped at the first 50 events).
 */

import { getDashboardStats, getFilterOptions } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { UsageClient } from "./client";

export const dynamic = "force-dynamic";

const INITIAL_DAYS = 14;

export default async function UsagePage() {
  const [stats, filterOptions] = await Promise.all([
    getDashboardStats(INITIAL_DAYS),
    getFilterOptions(),
  ]);

  const usingSeedData = stats.usingSeedData;

  const initialBuckets = stats.dailyTotals.map((d) => ({
    label: d.date,
    tokens: Number(d.tokens) || 0,
    cost: Number(d.cost ?? 0) || 0,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Token usage over time by user, model, and project
          </p>
        </div>
        <Badge variant={usingSeedData ? "secondary" : "outline"} className="text-xs">
          {usingSeedData ? "Seed data" : `${stats.totalEvents.toLocaleString()} events`}
        </Badge>
      </div>

      <UsageClient
        initialDays={stats.periodDays ?? INITIAL_DAYS}
        initialBuckets={initialBuckets}
        models={filterOptions.models}
        userIds={filterOptions.userIds}
        userNames={Object.fromEntries(filterOptions.userNames)}
        projectNames={Object.fromEntries(filterOptions.projectNames)}
        usingSeedData={usingSeedData}
      />
    </div>
  );
}
