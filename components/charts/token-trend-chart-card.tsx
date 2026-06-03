"use client";

/**
 * TokenTrendChartCard — shared bar-chart card used by the dashboard and the
 * /usage page. Owns the timeframe (1D/3D/7D/14D/30D/Custom), granularity
 * (Hour/Day/Week/Month), and stack-by dimension (none/model/project/user/
 * provider/source). Self-fetches /api/usage-trend on change.
 *
 * Parent supplies the initial server-prefetched buckets so first paint is
 * instant. Parents that need to react to range/filter changes (e.g. /usage's
 * events table) subscribe via onTimeframeChange. Parents that want to derive
 * summary cards from the current buckets subscribe via onBucketsChange.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsageBarChart } from "@/components/charts/usage-bar";
import { UsageStackedBarChart } from "@/components/charts/usage-stacked-bar";
import { formatCost, formatTokens, formatTokensExact } from "@/lib/utils";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "@/lib/preferences";

export type Bucket = { label: string; tokens: number; cost: number };
export type Granularity = "hour" | "day" | "week" | "month";
export type Range = "1D" | "3D" | "7D" | "14D" | "30D" | "custom";
export type Dimension = "none" | "model" | "project" | "user" | "provider" | "source";

export interface TimeframeParams {
  range: Range;
  days?: number;
  from?: string;
  to?: string;
  granularity: Granularity;
  dimension: Dimension;
}

interface Props {
  initialBuckets: Bucket[];
  initialDays: number;
  /** Extra query params forwarded to /api/usage-trend (e.g. user_id, model). */
  extraQuery?: Record<string, string>;
  /** Show the granularity (Hour/Day/Week/Month) controls. Default true. */
  showGranularity?: boolean;
  /** Show the "Stack by" dimension controls. Default true. */
  showStackBy?: boolean;
  /** Chart height in pixels. */
  height?: number;
  /** Notified whenever the effective timeframe changes. */
  onTimeframeChange?: (params: TimeframeParams) => void;
  /** Notified whenever the chart's buckets refresh. */
  onBucketsChange?: (buckets: Bucket[], granularity: Granularity) => void;
}

const ALL_GRANULARITY_OPTIONS: { id: Granularity; label: string }[] = [
  { id: "hour", label: "Hour" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const QUICK_RANGES: { id: Exclude<Range, "custom">; days: number }[] = [
  { id: "1D", days: 1 },
  { id: "3D", days: 3 },
  { id: "7D", days: 7 },
  { id: "14D", days: 14 },
  { id: "30D", days: 30 },
];

const STACK_OPTIONS: Dimension[] = ["none", "model", "project", "user", "provider", "source"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function shortLabel(s: string, g: Granularity): string {
  if (g === "hour") return s.slice(11, 16);
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildQuery(parts: Record<string, string | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
    .join("&");
}

export function TokenTrendChartCard({
  initialBuckets,
  initialDays,
  extraQuery,
  showGranularity = true,
  showStackBy = true,
  height = 200,
  onTimeframeChange,
  onBucketsChange,
}: Props) {
  const [range, setRange] = useState<Range>(`${initialDays}D` as Range);
  const [buckets, setBuckets] = useState<Bucket[]>(initialBuckets);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [loading, setLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());
  const [dimension, setDimension] = useState<Dimension>("none");
  const [stacked, setStacked] = useState<{ buckets: any[]; series: string[] } | null>(null);

  useEffect(() => {
    const pref = loadPrefs().defaultChartTimeframe;
    if (pref && pref !== `${initialDays}D`) setRange(pref as Range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function effectiveTimeframe(): TimeframeParams {
    if (range === "custom") {
      return { range, from: customFrom, to: customTo, granularity, dimension };
    }
    const def = QUICK_RANGES.find((r) => r.id === range);
    return { range, days: def?.days ?? initialDays, granularity, dimension };
  }

  async function loadFlat(qs: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/usage-trend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      const next = (j.buckets ?? []) as Bucket[];
      const nextGran = (j.granularity ?? "day") as Granularity;
      setBuckets(next);
      setGranularity(nextGran);
      onBucketsChange?.(next, nextGran);
    } finally {
      setLoading(false);
    }
  }

  async function loadStacked(qs: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/usage-trend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setStacked({ buckets: j.buckets ?? [], series: j.series ?? [] });
      setGranularity((j.granularity ?? "day") as Granularity);
    } finally {
      setLoading(false);
    }
  }

  // Refetch on any input change (except customFrom/customTo while range=custom,
  // which are gated behind the Apply button).
  useEffect(() => {
    const tf = effectiveTimeframe();
    onTimeframeChange?.(tf);

    if (range === "custom") return;

    const baseParams: Record<string, string> = {
      days: String(tf.days ?? initialDays),
      granularity,
      ...(extraQuery ?? {}),
    };

    if (dimension === "none") {
      setStacked(null);
      loadFlat(buildQuery(baseParams));
    } else {
      loadStacked(buildQuery({ ...baseParams, group_by: dimension }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, granularity, dimension, JSON.stringify(extraQuery ?? {})]);

  function applyCustom() {
    const tf = effectiveTimeframe();
    onTimeframeChange?.(tf);
    const baseParams: Record<string, string> = {
      from: customFrom,
      to: customTo,
      granularity,
      ...(extraQuery ?? {}),
    };
    if (dimension === "none") {
      setStacked(null);
      loadFlat(buildQuery(baseParams));
    } else {
      loadStacked(buildQuery({ ...baseParams, group_by: dimension }));
    }
  }

  const totals = useMemo(() => {
    const tokens = buckets.reduce((s, b) => s + (Number(b.tokens) || 0), 0);
    const cost = buckets.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    return { tokens, cost };
  }, [buckets]);

  const chartData = useMemo(
    () =>
      buckets.map((b) => ({
        label: shortLabel(b.label, granularity),
        tokens: Number(b.tokens) || 0,
      })),
    [buckets, granularity],
  );

  const titleSuffix =
    range === "custom"
      ? `${customFrom} – ${customTo}`
      : range === "1D"
        ? "Last 24h"
        : `${range.replace("D", "")}-day`;

  return (
    <Card>
      <CardHeader className="px-6 pb-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm font-medium">{titleSuffix} trend</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums" title={totals.tokens >= 1_000_000_000 ? formatTokensExact(totals.tokens) : undefined}>
              {formatTokens(totals.tokens)} tokens · {formatCost(totals.cost)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {QUICK_RANGES.map((r) => (
              <Button
                key={r.id}
                variant={range === r.id ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setRange(r.id)}
                disabled={loading}
              >
                {r.id}
              </Button>
            ))}
            <Button
              variant={range === "custom" ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setRange("custom")}
              disabled={loading}
            >
              Custom
            </Button>
          </div>
        </div>
        {range === "custom" && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              max={customTo}
              className="h-7 w-[150px] text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              min={customFrom}
              max={todayIso()}
              className="h-7 w-[150px] text-xs"
            />
            <Button
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={applyCustom}
              disabled={loading || !customFrom || !customTo}
            >
              Apply
            </Button>
          </div>
        )}
      </CardHeader>

      {(showGranularity || showStackBy) && (
        <div className="px-6 pt-1 flex flex-wrap items-center gap-3">
          {showGranularity && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                Bucket
              </span>
              {ALL_GRANULARITY_OPTIONS.map((g) => {
                const enabled = (loadPrefs().enabledGranularities ?? []).some((id) =>
                  id.includes(g.id),
                );
                if (!enabled && g.id !== "day" && g.id !== "hour") return null;
                return (
                  <Button
                    key={g.id}
                    variant={granularity === g.id ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setGranularity(g.id)}
                    disabled={loading}
                  >
                    {g.label}
                  </Button>
                );
              })}
            </div>
          )}
          {showStackBy && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                Stack by
              </span>
              {STACK_OPTIONS.map((d) => (
                <Button
                  key={d}
                  variant={dimension === d ? "default" : "outline"}
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    setDimension(d);
                    if (d !== "none") savePrefs({ defaultDimension: d });
                  }}
                  disabled={loading}
                >
                  {d}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <CardContent className="px-6 pb-2">
        {dimension === "none" || !stacked ? (
          <UsageBarChart data={chartData} height={height} />
        ) : (
          <UsageStackedBarChart buckets={stacked.buckets} series={stacked.series} height={height + 20} />
        )}
      </CardContent>
    </Card>
  );
}

// Re-export for callers that want defaults
export const DEFAULT_TREND_PREFS = DEFAULT_PREFS;
