"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCost, formatTokens } from "@/lib/utils";

const PROVIDER_BADGE: Record<string, string> = {
  anthropic: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  openai: "bg-green-500/15 text-green-400 border-green-500/30",
  "openai-codex": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  google: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const columns: any[] = [
  {
    accessorKey: "provider",
    header: "Provider",
    cell: (info: any) => (
      <Badge variant="outline" className={`text-xs font-normal ${PROVIDER_BADGE[(info.getValue() as string).toLowerCase()] ?? "bg-muted text-muted-foreground border-border"}`}>
        {info.getValue() as string}
      </Badge>
    ),
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: (info: any) => <span className="font-mono text-xs">{info.getValue() as string}</span>,
  },
  {
    accessorKey: "event_count",
    header: "Events",
    cell: (info: any) => <span className="text-right tabular-nums text-xs text-muted-foreground">{(info.getValue() as number).toLocaleString()}</span>,
  },
  {
    accessorKey: "input_tokens",
    header: "Input Tokens",
    cell: (info: any) => <span className="text-right tabular-nums text-xs text-muted-foreground">{formatTokens(info.getValue() as number)}</span>,
  },
  {
    accessorKey: "output_tokens",
    header: "Output Tokens",
    cell: (info: any) => <span className="text-right tabular-nums text-xs text-muted-foreground">{formatTokens(info.getValue() as number)}</span>,
  },
  {
    accessorKey: "total_tokens",
    header: "Total Tokens",
    cell: (info: any) => <span className="text-right tabular-nums text-xs font-medium">{formatTokens(info.getValue() as number)}</span>,
  },
  {
    accessorKey: "cost_usd",
    header: "Cost (USD)",
    cell: (info: any) => <span className="text-right tabular-nums text-xs">{info.getValue() != null ? formatCost(info.getValue() as number) : "—"}</span>,
  },
];

export function ModelsClient({ models }: { models: any[] }) {
  return <DataTable columns={columns} data={models} pageSize={50} globalFilterPlaceholder="Filter models…" />;
}
