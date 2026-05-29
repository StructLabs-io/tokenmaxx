/**
 * /usage -- Filterable time-series of usage_events
 *
 * Server component: fetches events + filter options from lib/data.ts.
 * Falls back to seed data when Supabase is not configured.
 * Client component (UsageClient) handles filter UI and chart interactivity.
 */

import { getUsageEvents, getFilterOptions } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { UsageClient } from "./client";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const [eventsResult, filterOptions] = await Promise.all([
    getUsageEvents({ limit: 50 }),
    getFilterOptions(),
  ]);

  const usingSeedData = eventsResult.usingSeedData;

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
          {usingSeedData ? "Seed data" : `${eventsResult.total.toLocaleString()} events`}
        </Badge>
      </div>

      <UsageClient
        initialEvents={eventsResult.events}
        totalCount={eventsResult.total}
        models={filterOptions.models}
        userIds={filterOptions.userIds}
        userNames={Object.fromEntries(filterOptions.userNames)}
        usingSeedData={usingSeedData}
      />
    </div>
  );
}
