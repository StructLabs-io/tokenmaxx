"use client";

/**
 * UsageClient -- /usage page client logic.
 *
 * The chart is rendered by the shared TokenTrendChartCard (same component the
 * dashboard uses). This page also shows the paginated events table for the
 * active timeframe + filters; the table re-fetches whenever the chart card
 * emits an onTimeframeChange.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCost } from "@/lib/utils";
import {
  TokenTrendChartCard,
  type Bucket,
  type TimeframeParams,
} from "@/components/charts/token-trend-chart-card";
import type { UsageEventRow, EventsPage } from "@/lib/supabase/types";

const PAGE_SIZE = 50;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function rangeToDateBounds(tf: TimeframeParams, initialDays: number): { from: string; to: string } {
  if (tf.range === "custom") {
    return { from: tf.from ?? daysAgoIso(initialDays - 1), to: tf.to ?? todayIso() };
  }
  const days = tf.days ?? initialDays;
  return { from: daysAgoIso(days - 1), to: todayIso() };
}

interface Props {
  initialDays: number;
  initialBuckets: Bucket[];
  models: string[];
  userIds: string[];
  userNames: Record<string, string>;
  projectNames: Record<string, string>;
  usingSeedData: boolean;
}

export function UsageClient({
  initialDays,
  initialBuckets,
  models,
  userIds,
  userNames,
  projectNames,
  usingSeedData,
}: Props) {
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterModel, setFilterModel] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<TimeframeParams>({
    range: `${initialDays}D` as TimeframeParams["range"],
    days: initialDays,
    granularity: "day",
    dimension: "none",
  });

  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [totalEvents, setTotalEvents] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  const extraQuery = useMemo(() => {
    const q: Record<string, string> = {};
    if (filterUser !== "all") q.user_id = filterUser;
    if (filterModel !== "all") q.model = filterModel;
    return q;
  }, [filterUser, filterModel]);

  async function loadTable(targetPage: number) {
    setTableLoading(true);
    try {
      const { from, to } = rangeToDateBounds(timeframe, initialDays);
      const parts: string[] = [`page=${targetPage}`, `pageSize=${PAGE_SIZE}`, `from=${from}`, `to=${to}`];
      if (filterUser !== "all") parts.push(`user=${encodeURIComponent(filterUser)}`);
      if (filterModel !== "all") parts.push(`model=${encodeURIComponent(filterModel)}`);
      const r = await fetch(`/api/events?${parts.join("&")}`, { cache: "no-store" });
      if (!r.ok) {
        setEvents([]);
        setTotalEvents(0);
        return;
      }
      const j = (await r.json()) as EventsPage;
      setEvents(j.events ?? []);
      setTotalEvents(j.total ?? 0);
      setPage(j.page ?? targetPage);
    } finally {
      setTableLoading(false);
    }
  }

  // Refetch the events table when the timeframe or filters change.
  useEffect(() => {
    setPage(0);
    loadTable(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe.range, timeframe.days, timeframe.from, timeframe.to, filterUser, filterModel]);

  const pageCount = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));

  function displayUser(userId: string): string {
    return userNames[userId] ?? userId;
  }

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
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

        <span className="text-sm text-muted-foreground self-center ml-auto tabular-nums">
          {totalEvents.toLocaleString()} events in window
          {usingSeedData && " (seed)"}
        </span>
      </div>

      <TokenTrendChartCard
        initialBuckets={initialBuckets}
        initialDays={initialDays}
        extraQuery={extraQuery}
        height={220}
        onTimeframeChange={(tf) => setTimeframe(tf)}
      />

      {/* Event table — server-paginated, matches the chart's timeframe + filters */}
      <Card>
        <CardHeader className="px-6">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">Events</CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {tableLoading
                ? "Loading…"
                : totalEvents === 0
                  ? "No events"
                  : `Page ${page + 1} of ${pageCount} · ${totalEvents.toLocaleString()} total`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Capture method</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right pr-6">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(e.captured_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.user_display_name ?? displayUser(e.user_id)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {e.project_id
                      ? (e.project_display_name ?? projectNames[e.project_id] ?? e.project_id)
                      : <span className="italic">unattributed</span>}
                  </TableCell>
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
              {!tableLoading && events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-6">
                    No events for the selected timeframe and filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {totalEvents > PAGE_SIZE && (
            <div className="flex items-center justify-end gap-2 px-6 py-3">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={tableLoading || page === 0}
                onClick={() => loadTable(page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={tableLoading || page + 1 >= pageCount}
                onClick={() => loadTable(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
