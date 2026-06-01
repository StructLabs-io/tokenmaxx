"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsageBarChart } from "@/components/charts/usage-bar";
import { UsageStackedBarChart } from "@/components/charts/usage-stacked-bar";
import { formatCost, formatTokens } from "@/lib/utils";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "@/lib/preferences";

type Bucket = { label: string; tokens: number; cost: number };
type Granularity = "hour" | "day" | "week" | "month";
type Range = "1D" | "3D" | "7D" | "14D" | "30D" | "custom";

const ALL_GRANULARITY_OPTIONS: { id: Granularity; label: string }[] = [
  { id: "hour", label: "Hour" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const QUICK_RANGES: { id: Exclude<Range, "custom">; days: number }[] = [
  { id: "1D", days: 1 }, { id: "3D", days: 3 }, { id: "7D", days: 7 },
  { id: "14D", days: 14 }, { id: "30D", days: 30 },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function shortLabel(s: string, g: Granularity): string {
  if (g === "hour") return s.slice(11, 16);
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface Props {
  initialBuckets: Bucket[];
  initialDays: number;
}

/**
 * Top-of-dashboard block: 4 stat cards + bar chart with timeframe buttons.
 * Stat cards re-derive from the same buckets the chart shows, so changing
 * the timeframe updates everything in one motion (§2.4).
 */
export function DashboardTop({ initialBuckets, initialDays }: Props) {
  const [range, setRange] = useState<Range>(`${initialDays}D` as Range);
  const [buckets, setBuckets] = useState<Bucket[]>(initialBuckets);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [loading, setLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());
  type Dim = "none" | "model" | "project" | "user" | "provider" | "source";
  const [dimension, setDimension] = useState<Dim>("none");
  const [stacked, setStacked] = useState<{ buckets: any[]; series: string[] } | null>(null);

  // Honour the user's default timeframe pref on first mount if they set one.
  useEffect(() => {
    const pref = loadPrefs().defaultChartTimeframe;
    if (pref && pref !== `${initialDays}D`) setRange(pref as Range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(qs: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/usage-trend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setBuckets(j.buckets ?? []);
      setGranularity(j.granularity ?? "day");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (range === "custom") return;
    const def = QUICK_RANGES.find((r) => r.id === range);
    if (!def) return;
    if (range === `${initialDays}D` && buckets === initialBuckets && granularity === "day" && dimension === "none") return;
    const gq = `granularity=${granularity}`;
    if (dimension === "none") {
      setStacked(null);
      load(`days=${def.days}&${gq}`);
    } else {
      loadStacked(`days=${def.days}&group_by=${dimension}&${gq}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, dimension, granularity]);

  async function loadStacked(qs: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/usage-trend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setStacked({ buckets: j.buckets ?? [], series: j.series ?? [] });
      setGranularity(j.granularity ?? "day");
    } finally { setLoading(false); }
  }

  const totals = useMemo(() => {
    const tokens = buckets.reduce((s, b) => s + (Number(b.tokens) || 0), 0);
    const cost = buckets.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    // "Today's tokens" = last bucket
    const today = buckets[buckets.length - 1];
    const todayTokens = Number(today?.tokens) || 0;
    const todayCost = Number(today?.cost) || 0;
    // "This week" = last 7 buckets (when granularity=day) or last day's worth (when granularity=hour)
    const weekSlice = granularity === "hour" ? buckets : buckets.slice(-7);
    const weekTokens = weekSlice.reduce((s, b) => s + (Number(b.tokens) || 0), 0);
    const weekCost = weekSlice.reduce((s, b) => s + (Number(b.cost) || 0), 0);
    return { tokens, cost, todayTokens, todayCost, weekTokens, weekCost };
  }, [buckets, granularity]);

  const chartData = buckets.map((b) => ({
    label: shortLabel(b.label, granularity),
    tokens: Number(b.tokens) || 0,
  }));

  const periodLabel =
    range === "custom" ? `${customFrom} – ${customTo}` :
    range === "1D" ? "24h" : range.replace("D", "d");
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

      {/* Trend chart */}
      <Card>
        <CardHeader className="px-6 pb-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-sm font-medium">
                {range === "custom" ? `${customFrom} – ${customTo}` : `${range === "1D" ? "Last 24h" : `${range.replace("D", "")}-day`}`} trend
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
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
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={customTo} className="h-7 w-[150px] text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} min={customFrom} max={todayIso()} className="h-7 w-[150px] text-xs" />
              <Button size="sm" className="h-7 px-3 text-xs" onClick={() => load(`from=${customFrom}&to=${customTo}`)} disabled={loading || !customFrom || !customTo}>Apply</Button>
            </div>
          )}
        </CardHeader>
        {/* §2.5 + §2.6 — granularity + dimension controls */}
        <div className="px-6 pt-1 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Bucket</span>
            {ALL_GRANULARITY_OPTIONS.map((g) => {
              const enabled = (loadPrefs().enabledGranularities ?? []).some((id) => id.includes(g.id));
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
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Stack by</span>
            {(["none", "model", "project", "user", "provider", "source"] as const).map((d) => (
              <Button
                key={d}
                variant={dimension === d ? "default" : "outline"}
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => { setDimension(d); savePrefs({ defaultDimension: d === "none" ? "model" : d }); }}
                disabled={loading}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
        <CardContent className="px-6 pb-2">
          {dimension === "none" || !stacked ? (
            <UsageBarChart data={chartData} height={200} />
          ) : (
            <UsageStackedBarChart buckets={stacked.buckets} series={stacked.series} height={220} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
