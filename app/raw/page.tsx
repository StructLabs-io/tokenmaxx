/**
 * /raw -- Paginated usage_events table view
 *
 * Server component: fetches first page of events + filter options from lib/data.ts.
 * Client component (RawClient) handles pagination, search, and filter UI.
 * Falls back to seed data when Supabase is not configured.
 */

import { getUsageEvents, getFilterOptions } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { RawClient } from "./client";

export const dynamic = "force-dynamic";

export default async function RawPage() {
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
          <h1 className="text-xl font-semibold tracking-tight">Raw Events</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All usage_events — newest first
          </p>
        </div>
        <Badge variant={usingSeedData ? "secondary" : "outline"} className="text-xs">
          {usingSeedData ? "Seed data" : `${eventsResult.total.toLocaleString()} events`}
        </Badge>
      </div>

      <RawClient
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
