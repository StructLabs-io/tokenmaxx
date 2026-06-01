"use client";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { formatTokens, formatTokensCompact } from "@/lib/utils";

interface StackedBucket {
  label: string;
  // each series key has { tokens, cost }
  series: Record<string, { tokens: number; cost: number }>;
}

interface Props {
  buckets: StackedBucket[];
  series: string[];
  height?: number;
}

// Consistent color palette for stacked series (10 distinct).
const PALETTE = [
  "#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4",
  "#a855f7", "#ef4444", "#84cc16", "#14b8a6", "#f97316",
];

export function UsageStackedBarChart({ buckets, series, height = 220 }: Props) {
  // Flatten data so each row = bucket + one numeric per series.
  const data = buckets.map((b) => {
    const row: any = { label: b.label };
    for (const s of series) {
      row[s] = Number(b.series?.[s]?.tokens) || 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => formatTokensCompact(v)}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [formatTokens(value), name]}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="a"
            fill={PALETTE[i % PALETTE.length]}
            isAnimationActive={false}
            minPointSize={1}
            radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
