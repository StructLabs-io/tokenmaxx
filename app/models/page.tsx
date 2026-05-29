/**
 * /models -- AI model usage breakdown
 *
 * Server Component: fetches model breakdown from lib/data.ts (getModelBreakdown).
 * Falls back to seed data when Supabase is not configured.
 */

import { getModelBreakdown } from "@/lib/data";
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

const PROVIDER_BADGE: Record<string, string> = {
  anthropic: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  openai: "bg-green-500/15 text-green-400 border-green-500/30",
  "openai-codex": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  google: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

function providerBadgeClass(provider: string): string {
  return PROVIDER_BADGE[provider.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
}

export default async function ModelsPage() {
  const models = await getModelBreakdown(30);

  const totalTokens = models.reduce((s, m) => s + m.total_tokens, 0);
  const totalCost = models.some((m) => m.cost_usd != null)
    ? models.reduce((s, m) => s + (m.cost_usd ?? 0), 0)
    : null;
  const totalEvents = models.reduce((s, m) => s + m.event_count, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Models</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI usage by model (30-day window)
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {totalEvents.toLocaleString()} events
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Models tracked</p>
            <p className="text-2xl font-bold">{models.length}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total tokens (30d)</p>
            <p className="text-2xl font-bold tabular-nums">{formatTokens(totalTokens)}</p>
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
      </div>

      {/* Models table */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">All models</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Input Tokens</TableHead>
                <TableHead className="text-right">Output Tokens</TableHead>
                <TableHead className="text-right">Total Tokens</TableHead>
                <TableHead className="text-right pr-6">Cost (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="pl-6 text-muted-foreground text-sm">
                    No model data for this period.
                  </TableCell>
                </TableRow>
              ) : (
                models.map((row) => (
                  <TableRow key={`${row.provider}__${row.model}`}>
                    <TableCell className="pl-6">
                      <Badge
                        variant="outline"
                        className={`text-xs font-normal ${providerBadgeClass(row.provider)}`}
                      >
                        {row.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.model}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.event_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.input_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatTokens(row.output_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTokens(row.total_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums pr-6">
                      {row.cost_usd != null ? formatCost(row.cost_usd) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
