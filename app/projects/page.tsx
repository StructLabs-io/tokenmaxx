/**
 * /projects -- Project list with token + cost totals
 *
 * Server Component: fetches project list from lib/data.ts (getProjectsList).
 * Renders ProjectsClient for interactive add/edit functionality.
 * Falls back to seed data when Supabase is not configured.
 */

import { getProjectsList, isServiceRoleConfigured, isDemoMode } from "@/lib/data";
import { getSupabaseServerClient } from "@/lib/supabase/client";
import { formatTokens, formatCost } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectsClient } from "./client";

export const dynamic = "force-dynamic";

async function getProjectsWithBillable(days = 30) {
  const base = await getProjectsList(days);

  if (base.usingSeedData || !isServiceRoleConfigured()) {
    // Seed data doesn't carry billable — default true
    return {
      ...base,
      projects: base.projects.map((p) => ({ ...p, billable: true })),
    };
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("projects")
      .select("id,billable")
      .is("deleted_at", null) as { data: any[] | null };

    const billableMap = new Map<string, boolean>(
      (data ?? []).map((r: any) => [r.id, r.billable])
    );

    return {
      ...base,
      projects: base.projects.map((p) => ({
        ...p,
        billable: billableMap.get(p.id) ?? true,
      })),
    };
  } catch {
    return {
      ...base,
      projects: base.projects.map((p) => ({ ...p, billable: true })),
    };
  }
}

export default async function ProjectsPage() {
  const { projects, totalEvents, totalCost, unattributedCount, usingSeedData } =
    await getProjectsWithBillable(30);

  const totalTokens = projects.reduce((s, p) => s + p.totalTokens, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Summary cards */}
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
        <Card className={`gap-2 py-4 ${unattributedCount > 0 ? "border-warning/40 bg-warning/5" : ""}`}>
          <CardHeader className="px-4">
            <p className={`text-xs ${unattributedCount > 0 ? "text-warning" : "text-muted-foreground"}`}>
              {unattributedCount > 0 && "⚠ "}Unattributed events
            </p>
            <div className="flex items-baseline justify-between">
              <p className={`text-2xl font-bold tabular-nums ${unattributedCount > 0 ? "text-warning" : ""}`}>
                {unattributedCount.toLocaleString("en-US")}
              </p>
              {unattributedCount > 0 && (
                <a href="/reconcile" className="text-xs text-warning hover:underline">
                  Reconcile →
                </a>
              )}
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Interactive projects table (client component) */}
      <ProjectsClient
        projects={projects}
        totalTokens={totalTokens}
        unattributedCount={unattributedCount}
        usingSeedData={usingSeedData}
        isDemoMode={isDemoMode()}
      />
    </div>
  );
}
