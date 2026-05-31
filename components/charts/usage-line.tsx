"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { formatTokens, formatCost, formatTokensCompact, formatCostCompact } from "@/lib/utils";

interface DataPoint {
  date: string;
  tokens: number;
  cost: number;
}

interface UsageLineChartProps {
  data: DataPoint[];
  /** "tokens" or "cost" */
  metric?: "tokens" | "cost";
  height?: number;
}

export function UsageLineChart({
  data,
  metric = "tokens",
  height = 220,
}: UsageLineChartProps) {
  const dataKey = metric;
  const color = metric === "tokens" ? "#6366f1" : "#10b981";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: string) =>
            new Date(v).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          }
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={
            metric === "tokens"
              ? (v: number) => formatTokensCompact(v)
              : (v: number) => formatCostCompact(v)
          }
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "6px",
            fontSize: 12,
          }}
          formatter={(value: number) =>
            metric === "tokens"
              ? [formatTokens(value), "Tokens"]
              : [formatCost(value), "Cost"]
          }
          labelFormatter={(label: string) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })
          }
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
