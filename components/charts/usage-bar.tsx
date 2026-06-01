"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatTokens, formatTokensCompact } from "@/lib/utils";

interface BarDataPoint {
  label: string;
  tokens: number;
}

interface UsageBarChartProps {
  data: BarDataPoint[];
  height?: number;
  color?: string;
}

export function UsageBarChart({
  data,
  height = 180,
  color = "hsl(var(--chart-1))",
}: UsageBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: number) => formatTokensCompact(v)}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: 12,
          }}
          formatter={(value: number) => [formatTokens(value), "Tokens"]}
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
        />
        <Bar dataKey="tokens" fill={color} radius={[3, 3, 0, 0]} minPointSize={2} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
