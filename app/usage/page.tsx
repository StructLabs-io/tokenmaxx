"use client";

/**
 * /usage -- Filterable time-series of usage_events
 *
 * Data source: seed data until Supabase is wired (v0.2).
 * Filters: user, model -- client-side on seed data.
 * Chart: daily token totals line chart.
 */

import { useState, useMemo } from "react";
import {
  SEED_USAGE_EVENTS,
  SEED_USERS,
  seedDailyTotals,
} from "@/lib/seed-data";
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

const ALL_MODELS = Array.from(
  new Set(SEED_USAGE_EVENTS.map((e) => e.model))
).sort();

export default function UsagePage() {
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterModel, setFilterModel] = useState<string>("all");

  const filtered = useMemo(() => {
    return SEED_USAGE_EVENTS.filter((e) => {
      if (filterUser !== "all" && e.user_id !== filterUser) return false;
      if (filterModel !== "all" && e.model !== filterModel) return false;
      return true;
    }).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [filterUser, filterModel]);

  const dailyTotals = useMemo(() => seedDailyTotals(filtered), [filtered]);

  function displayUser(userId: string): string {
    return SEED_USERS.find((u) => u.id === userId)?.display_name ?? userId;
  }

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
        <Badge variant="secondary" className="text-xs">
          Seed data mode
        </Badge>
      </div>

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
            {SEED_USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
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
            {ALL_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <span className="text-sm text-muted-foreground self-center ml-auto">
          {filtered.length} events
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
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right pr-6">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 50).map((e: UsageEvent) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6 text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString("en-US", {
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
                    {e.tool}
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
              Showing 50 of {filtered.length} events
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
