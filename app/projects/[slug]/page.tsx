/**
 * /projects/[slug] -- Project detail
 *
 * Server component: fetches project + usage from lib/data.ts (getProjectDetail).
 * Falls back to seed data when Supabase is not configured.
 * generateStaticParams uses seed projects to enable static pre-rendering of known slugs.
 */

import { notFound } from "next/navigation";
import { getProjectDetail } from "@/lib/data";
import { SEED_PROJECTS } from "@/lib/data";
import { formatTokens, formatCost } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsageLineChart } from "@/components/charts/usage-line";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return SEED_PROJECTS.map((p) => ({ slug: p.slug }));
}

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: Props) {
  const { slug } = await params;
  const {
    project,
    events,
    dailyTotals,
    modelBreakdown,
    totalTokens,
    totalCost,
    usingSeedData,
  } = await getProjectDetail(slug);

  if (!project) notFound();

  const chartData = dailyTotals.map((d) => ({ ...d, cost: d.cost ?? 0 }));
  const totalInputTokens = events.reduce((s, e) => s + e.input_tokens, 0);
  const totalOutputTokens = events.reduce((s, e) => s + e.output_tokens, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="h-4 w-4 rounded-full shrink-0"
          style={{ background: "#6366f1" }}
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {project.display_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            slug: {project.slug}
            {project.toggl_project_id != null
              ? ` · Toggl #${project.toggl_project_id}`
              : " · No Toggl project linked"}
            {project.client ? ` · ${project.client}` : ""}
          </p>
        </div>
        <Badge
          variant={usingSeedData ? "secondary" : "outline"}
          className="text-xs ml-auto"
        >
          {usingSeedData ? "Seed data" : `${events.length} recent events`}
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total tokens</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatTokens(totalTokens)}
            </p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total cost</p>
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
            <p className="text-xs text-muted-foreground">Input tokens</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatTokens(totalInputTokens)}
            </p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Output tokens</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatTokens(totalOutputTokens)}
            </p>
          </CardHeader>
        </Card>
      </div>

      {/* Daily timeline */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="px-6">
            <CardTitle className="text-sm font-medium">
              Daily token usage
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-2">
            <UsageLineChart data={chartData} metric="tokens" height={180} />
          </CardContent>
        </Card>
      )}

      {/* Model breakdown */}
      {modelBreakdown.length > 0 && (
        <Card>
          <CardHeader className="px-6">
            <CardTitle className="text-sm font-medium">By model</CardTitle>
          </CardHeader>
          <CardContent className="px-6">
            <div className="space-y-3">
              {modelBreakdown.map(({ model, tokens, cost }) => (
                <div key={model} className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-xs">
                    {model}
                  </Badge>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {cost != null ? formatCost(cost) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatTokens(tokens)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent events (10 most recent) */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">
            Recent events ({events.length} shown)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
                >
                  <div>
                    <p className="text-sm">
                      <span className="text-muted-foreground">via</span>{" "}
                      {e.capture_method}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.captured_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      <Badge variant="outline" className="text-xs font-mono py-0">
                        {e.model}
                      </Badge>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums">
                      {e.cost_usd != null ? formatCost(e.cost_usd) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatTokens(e.total_tokens)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
