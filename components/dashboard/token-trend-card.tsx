"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsageBarChart } from "@/components/charts/usage-bar";

type Bucket = { label: string; tokens: number; cost: number };
type Granularity = "hour" | "day";
type Range = "1D" | "3D" | "7D" | "14D" | "30D" | "custom";

const QUICK_RANGES: { id: Exclude<Range, "custom">; days: number }[] = [
  { id: "1D", days: 1 },
  { id: "3D", days: 3 },
  { id: "7D", days: 7 },
  { id: "14D", days: 14 },
  { id: "30D", days: 30 },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function shortLabel(s: string, granularity: Granularity): string {
  if (granularity === "hour") {
    // "2026-06-01T14:00" -> "14:00"
    return s.slice(11, 16);
  }
  // "2026-06-01" -> "Jun 1"
  const d = new Date(`${s}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

interface Props {
  initialBuckets: Bucket[];
}

export function TokenTrendCard({ initialBuckets }: Props) {
  const [range, setRange] = useState<Range>("14D");
  const [buckets, setBuckets] = useState<Bucket[]>(initialBuckets);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [loading, setLoading] = useState(false);
  const [customFrom, setCustomFrom] = useState(daysAgoIso(30));
  const [customTo, setCustomTo] = useState(todayIso());

  async function load(qs: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/usage-trend?${qs}`, { cache: "no-store" });
      const j = await r.json();
      setBuckets(j.buckets ?? []);
      setGranularity(j.granularity ?? "day");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load when range changes (except custom — that has its own Apply button)
  useEffect(() => {
    if (range === "custom") return;
    const def = QUICK_RANGES.find((r) => r.id === range);
    if (!def) return;
    if (range === "14D" && initialBuckets.length > 0 && granularity === "day") {
      // 14D is the SSR default — skip refetch on first mount
      return;
    }
    load(`days=${def.days}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const chartData = buckets.map((b) => ({ label: shortLabel(b.label, granularity), tokens: b.tokens }));
  const totalTokens = buckets.reduce((s, b) => s + b.tokens, 0);
  const totalCost = buckets.reduce((s, b) => s + b.cost, 0);

  const title =
    range === "custom"
      ? `${customFrom} – ${customTo} token trend`
      : `${range === "1D" ? "Last 24h" : `${range.replace("D", "")}-day`} token trend`;

  return (
    <Card>
      <CardHeader className="px-6 pb-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {totalTokens.toLocaleString()} tokens · ${totalCost.toFixed(2)}
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
              onClick={() => load(`from=${customFrom}&to=${customTo}`)}
              disabled={loading || !customFrom || !customTo}
            >
              Apply
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="px-6 pb-2">
        <UsageBarChart data={chartData} height={180} />
      </CardContent>
    </Card>
  );
}
