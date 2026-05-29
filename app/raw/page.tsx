"use client";

/**
 * /raw -- Paginated usage_events table view with query input and CSV export stub
 *
 * Data source: seed data until Supabase is wired (v0.2).
 * Realtime: stub -- will subscribe to usage_events on real client.
 */

import { useState, useMemo } from "react";
import {
  SEED_USAGE_EVENTS,
  SEED_USERS,
  SEED_PROJECTS,
} from "@/lib/seed-data";
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

const PAGE_SIZE = 25;

export default function RawPage() {
  const [query, setQuery] = useState("");
  const [filterUser, setFilterUser] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [page, setPage] = useState(0);

  const sortedEvents = useMemo(
    () =>
      [...SEED_USAGE_EVENTS].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    []
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return sortedEvents.filter((e) => {
      if (filterUser !== "all" && e.user_id !== filterUser) return false;
      if (filterProject !== "all") {
        if (filterProject === "unattributed" && e.project_id != null)
          return false;
        if (
          filterProject !== "unattributed" &&
          e.project_id !== filterProject
        )
          return false;
      }
      if (q) {
        return (
          e.model.includes(q) ||
          e.tool.includes(q) ||
          e.capture_method.includes(q) ||
          e.id.includes(q)
        );
      }
      return true;
    });
  }, [sortedEvents, filterUser, filterProject, query]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function displayUser(userId: string): string {
    return SEED_USERS.find((u) => u.id === userId)?.display_name ?? userId;
  }

  function displayProject(projectId: string | null): string {
    if (!projectId) return "—";
    return SEED_PROJECTS.find((p) => p.id === projectId)?.name ?? projectId;
  }

  function handleExportCsv() {
    // CSV export stub -- replace with real data once Supabase is wired
    const header = [
      "id",
      "created_at",
      "user",
      "project",
      "model",
      "tool",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cost_usd",
      "capture_method",
    ].join(",");

    const rows = filtered.map((e) =>
      [
        e.id,
        e.created_at,
        displayUser(e.user_id),
        displayProject(e.project_id),
        e.model,
        e.tool,
        e.input_tokens,
        e.output_tokens,
        e.total_tokens,
        e.cost_usd,
        e.capture_method,
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Raw Events</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All usage_events -- newest first
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          Seed data mode
        </Badge>
      </div>

      {/* Realtime status banner */}
      <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Realtime subscription inactive -- Supabase not configured. Showing
          seed data.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search model, tool, id..."
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
          {SEED_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </select>

        <select
          value={filterProject}
          onChange={(e) => {
            setFilterProject(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="all">All projects</option>
          <option value="unattributed">Unattributed</option>
          {SEED_PROJECTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
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
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right pr-6">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageData.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(e.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {displayUser(e.user_id)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {displayProject(e.project_id)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs font-mono">
                      {e.model.split("-").slice(0, 2).join("-")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
