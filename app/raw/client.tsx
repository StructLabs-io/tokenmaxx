"use client";

/**
 * RawClient -- client-side filter/pagination UI for /raw
 *
 * Receives pre-fetched events from server component.
 * Client-side filter + pagination on the initial page data.
 */

import { useState, useMemo } from "react";
import { formatTokens, formatCost } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Search } from "lucide-react";
import type { UsageEvent } from "@/lib/supabase/types";

const PAGE_SIZE = 25;

interface Props {
  initialEvents: UsageEvent[];
  totalCount: number;
  models: string[];
  userIds: string[];
  userNames: Record<string, string>;
  projectIds: string[];
  projectNames: Record<string, string>;
  usingSeedData: boolean;
}

export function RawClient({
  initialEvents,
  totalCount,
  models,
  userIds,
  userNames,
  projectIds,
  projectNames,
  usingSeedData,
}: Props) {
  const [query, setQuery] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterModel, setFilterModel] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return initialEvents.filter((e) => {
      if (filterUser !== "all" && e.user_id !== filterUser) return false;
      if (filterModel !== "all" && e.model !== filterModel) return false;
      if (filterProject !== "all") {
        if (filterProject === "__unattributed__") {
          if (e.project_id) return false;
        } else if (e.project_id !== filterProject) {
          return false;
        }
      }
      if (q) {
        return (
          e.model.toLowerCase().includes(q) ||
          e.capture_method.toLowerCase().includes(q) ||
          (e.session_id?.toLowerCase().includes(q) ?? false) ||
          String(e.id).includes(q)
        );
      }
      return true;
    });
  }, [initialEvents, filterUser, filterModel, filterProject, query]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function displayUser(userId: string): string {
    return userNames[userId] ?? userId;
  }

  // TODO: Replace with server-side CSV export once Supabase is wired
  function handleExportCsv() {
    const header = [
      "id",
      "captured_at",
      "user_id",
      "project_id",
      "model",
      "capture_method",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cost_usd",
      "session_id",
    ].join(",");

    const rows = filtered.map((e) =>
      [
        e.id,
        e.captured_at,
        e.user_id,
        e.project_id ?? "",
        e.model,
        e.capture_method,
        e.input_tokens,
        e.output_tokens,
        e.total_tokens,
        e.cost_usd ?? "",
        e.session_id ?? "",
      ].join(",")
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tokenmaxx-events.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Status banner */}
      {usingSeedData ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Showing seed data — Supabase not configured.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          <p className="text-xs text-green-700 dark:text-green-400">
            Live data — showing first {initialEvents.length} of {totalCount.toLocaleString()} events.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search model, session id, capture method..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <select
          value={filterUser}
          onChange={(e) => {
            setFilterUser(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All users</option>
          {userIds.map((id) => (
            <option key={id} value={id}>
              {userNames[id] ?? id}
            </option>
          ))}
        </select>

        <select
          value={filterModel}
          onChange={(e) => {
            setFilterModel(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={filterProject}
          onChange={(e) => {
            setFilterProject(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground max-w-[220px]"
        >
          <option value="all">All projects</option>
          <option value="__unattributed__">— Unattributed —</option>
          {projectIds.map((id) => (
            <option key={id} value={id}>
              {projectNames[id] ?? id}
            </option>
          ))}
        </select>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={handleExportCsv}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="px-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">
              {filtered.length} events
            </CardTitle>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
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
              {pageData.map((e) => (
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
                    {displayUser(e.user_id)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {e.project_id ? (projectNames[e.project_id] ?? e.project_id) : <span className="italic">unattributed</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">
                      {e.model.split("-").slice(0, 3).join("-")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
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
        </CardContent>
      </Card>
    </>
  );
}
