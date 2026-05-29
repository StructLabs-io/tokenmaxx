/**
 * /reconcile — Event attribution UI
 *
 * Server component: pre-fetches unattributed event groups + project list.
 * Renders ReconcileClient for interactive reassignment.
 */

import { getUnattributedGroups, getProjectsForSelect } from "@/lib/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReconcileClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const [groups, projects] = await Promise.all([
    getUnattributedGroups(),
    getProjectsForSelect(),
  ]);

  const totalTokens = groups.reduce((s, g) => s + g.total_tokens, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reconcile</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Assign unattributed events to projects
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {groups.length} group{groups.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Unattributed groups</p>
            <p className="text-2xl font-bold tabular-nums">{groups.length}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Unattributed tokens</p>
            <p className="text-2xl font-bold tabular-nums">
              {totalTokens >= 1_000_000
                ? `${(totalTokens / 1_000_000).toFixed(1)}M`
                : totalTokens >= 1_000
                ? `${(totalTokens / 1_000).toFixed(1)}K`
                : totalTokens.toString()}
            </p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Projects available</p>
            <p className="text-2xl font-bold tabular-nums">{projects.length}</p>
          </CardHeader>
        </Card>
      </div>

      {/* Interactive table */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">Unattributed events</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ReconcileClient initialGroups={groups} projects={projects} />
        </CardContent>
      </Card>
    </div>
  );
}
