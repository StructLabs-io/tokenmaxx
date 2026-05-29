/**
 * /projects -- Project list with cost totals
 *
 * Data source: seed data until Supabase is wired (v0.2).
 */

import Link from "next/link";
import { SEED_USAGE_EVENTS, seedCostByProject } from "@/lib/seed-data";
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

export default function ProjectsPage() {
  const projectCosts = seedCostByProject(SEED_USAGE_EVENTS);
  const unattributed = SEED_USAGE_EVENTS.filter((e) => !e.project_id);
  const unattribCost = unattributed.reduce((s, e) => s + e.cost_usd, 0);
  const unattribTokens = unattributed.reduce((s, e) => s + e.total_tokens, 0);
  const totalCost = SEED_USAGE_EVENTS.reduce((s, e) => s + e.cost_usd, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI cost by project, attributed via Toggl
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          Seed data mode
        </Badge>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Projects tracked</p>
            <p className="text-2xl font-bold">{projectCosts.length}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total cost (14d)</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatCost(totalCost)}
            </p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Unattributed events</p>
            <p className="text-2xl font-bold tabular-nums">{unattributed.length}</p>
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
                <TableHead className="text-right">Total cost</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">% of spend</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectCosts.map(({ project, totalCost: pc, totalTokens: pt }) => (
                <TableRow key={project.id}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: project.color ?? "#6366f1" }}
                      />
                      <span className="font-medium">{project.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCost(pc)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(pt)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalCost > 0
                      ? `${Math.round((pc / totalCost) * 100)}%`
                      : "--"}
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
              {unattributed.length > 0 && (
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
                    {formatCost(unattribCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(unattribTokens)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalCost > 0
                      ? `${Math.round((unattribCost / totalCost) * 100)}%`
                      : "--"}
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
