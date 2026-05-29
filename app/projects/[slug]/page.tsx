/**
 * /projects/[slug] -- Project detail
 *
 * Shows: tokens + time spent + cost for a specific project.
 * Data source: seed data until Supabase is wired (v0.2).
 */

import { notFound } from "next/navigation";
import {
  SEED_PROJECTS,
  SEED_USAGE_EVENTS,
  SEED_USERS,
  seedDailyTotals,
} from "@/lib/seed-data";
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

export default async function ProjectDetailPage({ params }: Props) {
  const { slug } = await params;
  const project = SEED_PROJECTS.find((p) => p.slug === slug);
  if (!project) notFound();

  const events = SEED_USAGE_EVENTS.filter((e) => e.project_id === project.id);
  const dailyTotals = seedDailyTotals(events);

  const totalTokens = events.reduce((s, e) => s + e.total_tokens, 0);
  const totalCost = events.reduce((s, e) => s + e.cost_usd, 0);
  const totalInputTokens = events.reduce((s, e) => s + e.input_tokens, 0);
  const totalOutputTokens = events.reduce((s, e) => s + e.output_tokens, 0);

  // Per-model breakdown
  const byModel = new Map<string, { tokens: number; cost: number }>();
  for (const e of events) {
    const existing = byModel.get(e.model) ?? { tokens: 0, cost: 0 };
    byModel.set(e.model, {
      tokens: existing.tokens + e.total_tokens,
      cost: existing.cost + e.cost_usd,
    });
  }
  const modelBreakdown = Array.from(byModel.entries())
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.tokens - a.tokens);

  function displayUser(userId: string): string {
    return SEED_USERS.find((u) => u.id === userId)?.display_name ?? userId;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="h-4 w-4 rounded-full shrink-0"
          style={{ background: project.color ?? "#6366f1" }}
        />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            slug: {project.slug}
            {project.toggl_project_id != null
              ? ` · Toggl #${project.toggl_project_id}`
              : " · No Toggl project linked"}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs ml-auto">
          Seed data mode
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
              {formatCost(totalCost)}
            </p>
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
      {dailyTotals.length > 0 && (
        <Card>
          <CardHeader className="px-6">
            <CardTitle className="text-sm font-medium">
              Daily token usage
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-2">
            <UsageLineChart data={dailyTotals} metric="tokens" height={180} />
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
                      {formatCost(cost)}
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

      {/* Recent events */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">
            Recent events ({events.length} total)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <div className="space-y-2">
            {events.slice(0, 10).map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
              >
                <div>
                  <p className="text-sm">
                    {displayUser(e.user_id)}{" "}
                    <span className="text-muted-foreground">via</span>{" "}
                    {e.tool}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums">
                    {formatCost(e.cost_usd)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatTokens(e.total_tokens)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
