/**
 * /projects -- Project list with token + cost totals
 *
 * Server component: fetches project list from lib/data.ts (getProjectsList).
 * Falls back to seed data when Supabase is not configured.
 */

import Link from "next/link";
import { getProjectsList } from "@/lib/data";
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

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { projects, totalEvents, totalCost, unattributedCount, usingSeedData } =
    await getProjectsList(30);

  const totalTokens = projects.reduce((s, p) => s + p.totalTokens, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI usage by project (30-day window)
          </p>
        </div>
        <Badge variant={usingSeedData ? "secondary" : "outline"} className="text-xs">
          {usingSeedData ? "Seed data" : `${totalEvents.toLocaleString()} events`}
        </Badge>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Projects tracked</p>
            <p className="text-2xl font-bold">{projects.length}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total cost (30d)</p>
            <p className="text-2xl font-bold tabular-nums">
              {totalCost != null ? formatCost(totalCost) : "—"}
            </p>
            {totalCost == null && (
              <p className="text-xs text-muted-foreground">pending pricing</p>
            )}
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Unattributed events</p>
            <p className="text-2xl font-bold tabular-nums">{unattributedCount}</p>
          </CardHeader>
        </Card>
      </div>

      {/* Projects table */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">All projects</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Project</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">% of tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects
                .sort((a, b) => b.totalTokens - a.totalTokens)
                .map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: "#6366f1" }}
                        />
                        <span className="font-medium">{project.display_name}</span>
                        {project.client && (
                          <span className="text-xs text-muted-foreground">
                            · {project.client}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatTokens(project.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {totalTokens > 0
                        ? `${Math.round((project.totalTokens / totalTokens) * 100)}%`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {project.totalCost != null ? formatCost(project.totalCost) : "—"}
                    </TableCell>
                    <TableCell className="pr-6">
                      <Link
                        href={`/projects/${project.slug}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Details
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}

              {/* Unattributed row */}
              {unattributedCount > 0 && (
                <TableRow>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground shrink-0" />
                      <span className="text-muted-foreground italic">
                        Unattributed
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    —
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    —
                  </TableCell>
                  <TableCell className="pr-6" />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
