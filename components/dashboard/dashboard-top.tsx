"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCost, formatTokens } from "@/lib/utils";
import { TokenTrendChartCard, type Bucket, type Granularity } from "@/components/charts/token-trend-chart-card";

interface Props {
  initialBuckets: Bucket[];
  initialDays: number;
}

/**
 * Top-of-dashboard block: 4 stat cards + the shared bar chart card. Stat cards
 * re-derive from whatever buckets the chart card is currently showing, so
 * changing the timeframe updates everything in one motion (§2.4).
 */
export function DashboardTop({ initialBuckets, initialDays }: Props) {
  const [buckets, setBuckets] = useState<Bucket[]>(initialBuckets);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [periodLabel, setPeriodLabel] = useState<string>(
    initialDays === 1 ? "24h" : `${initialDays}d`,
  );

  const totals = useMemo(() => {
    const tokens = buckets.reduce((s, b) => s + (Number(b.tokens) || 0), 0);
    const cost = buckets.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    const today = buckets[buckets.length - 1];
    const todayTokens = Number(today?.tokens) || 0;
    const todayCost = Number(today?.cost) || 0;
    const weekSlice = granularity === "hour" ? buckets : buckets.slice(-7);
    const weekTokens = weekSlice.reduce((s, b) => s + (Number(b.tokens) || 0), 0);
    const weekCost = weekSlice.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    return { tokens, cost, todayTokens, todayCost, weekTokens, weekCost };
  }, [buckets, granularity]);

  const eventsCount = buckets.length;

  return (
    <>
      {/* Summary cards — re-derived from current buckets */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Latest period token</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">{formatTokens(totals.todayTokens)}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">
              {totals.todayCost > 0 ? formatCost(totals.todayCost) : "$ pending"} cost
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Trailing week</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">{formatTokens(totals.weekTokens)}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">{formatCost(totals.weekCost)} cost</p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total tokens ({periodLabel})</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">{formatTokens(totals.tokens)}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">{eventsCount} buckets</p>
          </CardContent>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardDescription>Total cost ({periodLabel})</CardDescription>
            <CardTitle className="text-2xl font-bold tabular-nums">{formatCost(totals.cost)}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground">USD</p>
          </CardContent>
        </Card>
      </div>

      <TokenTrendChartCard
        initialBuckets={initialBuckets}
        initialDays={initialDays}
        height={200}
        onBucketsChange={(next, gran) => {
          setBuckets(next);
          setGranularity(gran);
        }}
        onTimeframeChange={(tf) => {
          if (tf.range === "custom") {
            setPeriodLabel(`${tf.from} – ${tf.to}`);
          } else if (tf.range === "1D") {
            setPeriodLabel("24h");
          } else {
            setPeriodLabel(tf.range.replace("D", "d"));
          }
        }}
      />
    </>
  );
}
