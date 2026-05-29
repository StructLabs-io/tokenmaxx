"use client";

/**
 * UsageClient -- client-side filter UI for /usage
 *
 * Receives pre-fetched events from the server component.
 * Filters are applied client-side on the initial page of data.
 * For large datasets, users can navigate to /raw for paginated server-side filtering.
 */

import { useState, useMemo } from "react";
import { formatTokens, formatCost } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UsageLineChart } from "@/components/charts/usage-line";
import type { UsageEvent } from "@/lib/supabase/types";

interface Props {
  initialEvents: UsageEvent[];
  totalCount: number;
  models: string[];
  userIds: string[];
  userNames: Record<string, string>;
  usingSeedData: boolean;
}

export function UsageClient({
  initialEvents,
  totalCount,
  models,
  userIds,
  userNames,
  usingSeedData,
}: Props) {
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterModel, setFilterModel] = useState<string>("all");

  const filtered = useMemo(() => {
    return initialEvents.filter((e) => {
      if (filterUser !== "all" && e.user_id !== filterUser) return false;
      if (filterModel !== "all" && e.model !== filterModel) return false;
      return true;
    });
  }, [initialEvents, filterUser, filterModel]);

  // Daily totals for the sparkline
  const dailyTotals = useMemo(() => {
    const byDate = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of filtered) {
      const date = e.date_utc;
      const existing = byDate.get(date) ?? { tokens: 0, cost: null };
      byDate.set(date, {
        tokens: existing.tokens + e.total_tokens,
        cost: e.cost_usd != null ? (existing.cost ?? 0) + e.cost_usd : existing.cost,
      });
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { tokens, cost }]) => ({ date, tokens, cost: cost ?? 0 }));
  }, [filtered]);

  function displayUser(userId: string): string {
    return userNames[userId] ?? userId;
  }

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="filter-user">
            User
          </label>
          <select
            id="filter-user"
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="all">All users</option>
            {userIds.map((id) => (
              <option key={id} value={id}>
                {userNames[id] ?? id}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="filter-model">
            Model
          </label>
          <select
            id="filter-model"
            value={filterModel}
            onChange={(e) => setFilterModel(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="all">All models</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <span className="text-sm text-muted-foreground self-center ml-auto">
          {filtered.length} of {totalCount} events
          {usingSeedData && " (seed)"}
        </span>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">Daily tokens</CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-2">
          <UsageLineChart data={dailyTotals} metric="tokens" height={200} />
        </CardContent>
      </Card>

      {/* Event table */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">Events</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Capture method</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right pr-6">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 50).map((e: UsageEvent) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6 text-muted-foreground">
                    {new Date(e.captured_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>{displayUser(e.user_id)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">
                      {e.model}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {e.capture_method}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {e.input_tokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {e.output_tokens.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right pr-6 tabular-nums text-xs">
                    {formatCost(e.cost_usd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length > 50 && (
            <p className="text-xs text-muted-foreground px-6 py-3">
              Showing 50 of {filtered.length} — use{" "}
              <a href="/raw" className="text-primary hover:underline">
                /raw
              </a>{" "}
              for full paginated view
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
