"use client";

/**
 * ReconcileClient — interactive attribution assignment UI.
 *
 * Receives pre-fetched unattributed groups and a project list from the server component.
 * On "Assign", POSTs to /api/reconcile and removes the row from the local list.
 */

import { useState, useTransition } from "react";
import type { UnattributedGroup, ProjectTotals } from "@/lib/supabase/types";
import { formatTokens, formatCost, formatDateShort } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ReconcileClientProps {
  initialGroups: UnattributedGroup[];
  projects: ProjectTotals[];
}

export function ReconcileClient({ initialGroups, projects }: ReconcileClientProps) {
  const [groups, setGroups] = useState<UnattributedGroup[]>(initialGroups);
  // selected project per row: key = "date|model|capture_method"
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Set<string>>(new Set());

  function rowKey(g: UnattributedGroup) {
    return `${g.date_utc}|${g.model}|${g.capture_method}`;
  }

  function handleSelect(key: string, projectId: string) {
    setSelections((prev) => ({ ...prev, [key]: projectId }));
  }

  function handleAssign(group: UnattributedGroup) {
    const key = rowKey(group);
    const project_id = selections[key];
    if (!project_id) return;

    startTransition(async () => {
      setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });

      const res = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date_utc: group.date_utc,
          model: group.model,
          capture_method: group.capture_method,
          project_id,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrors((prev) => ({ ...prev, [key]: body.error ?? "Request failed" }));
        return;
      }

      // Remove from list
      setSuccesses((prev) => new Set(prev).add(key));
      setTimeout(() => {
        setGroups((prev) => prev.filter((g) => rowKey(g) !== key));
        setSuccesses((prev) => { const n = new Set(prev); n.delete(key); return n; });
      }, 600);
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No unattributed events found. All caught up.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Date</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="hidden md:table-cell">Capture method</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right hidden sm:table-cell">Cost</TableHead>
            <TableHead className="pr-4 w-64">Assign to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const key = rowKey(g);
            const isSuccess = successes.has(key);
            const errMsg = errors[key];

            return (
              <TableRow
                key={key}
                className={isSuccess ? "opacity-40 transition-opacity duration-300" : undefined}
              >
                <TableCell className="pl-4 tabular-nums text-sm">
                  {formatDateShort(g.date_utc)}
                </TableCell>
                <TableCell className="text-sm max-w-[160px] truncate">
                  {g.model}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                  {g.capture_method}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {g.event_count}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatTokens(g.total_tokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm hidden sm:table-cell">
                  {g.total_cost != null ? formatCost(g.total_cost) : "—"}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={selections[key] ?? ""}
                      onChange={(e) => handleSelect(key, e.target.value)}
                      disabled={pending || isSuccess}
                    >
                      <option value="" disabled>
                        Select project…
                      </option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                          {p.client ? ` (${p.client})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleAssign(g)}
                      disabled={!selections[key] || pending || isSuccess}
                      className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSuccess ? "Done" : "Assign"}
                    </button>
                  </div>
                  {errMsg && (
                    <p className="text-xs text-destructive mt-1">{errMsg}</p>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
