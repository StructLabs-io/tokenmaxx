"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCost, formatTokens, formatTokensExact } from "@/lib/utils";

const columns: any[] = [
  {
    accessorKey: "display_name",
    header: "Name",
    cell: (info: any) => (
      <div>
        <p className="text-sm font-medium">{info.getValue() as string}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{info.row.original.slug}</p>
      </div>
    ),
  },
  {
    accessorKey: "account_type",
    header: "Type",
    cell: (info: any) => (
      <Badge variant={info.getValue() === "human" ? "default" : "outline"} className="text-xs">
        {info.getValue() === "human" ? "Human" : "Service"}
      </Badge>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: (info: any) => (
      <span className="text-xs text-muted-foreground">{info.getValue() ?? "—"}</span>
    ),
  },
  {
    accessorKey: "default_timezone",
    header: "Timezone",
    cell: (info: any) => (
      <span className="text-xs text-muted-foreground">{info.getValue() ?? "UTC"}</span>
    ),
  },
  {
    accessorKey: "total_tokens",
    header: "Tokens (30d)",
    cell: (info: any) => {
      const n = info.getValue() as number;
      return (
        <span className="text-right tabular-nums text-xs" title={n >= 1_000_000_000 ? formatTokensExact(n) : undefined}>
          {formatTokens(n)}
        </span>
      );
    },
  },
  {
    accessorKey: "cost_usd",
    header: "Cost (30d)",
    cell: (info: any) => (
      <span className="text-right tabular-nums text-xs">{info.getValue() != null ? formatCost(info.getValue() as number) : "—"}</span>
    ),
  },
];

export function UsersClient({ users }: { users: any[] }) {
  return <DataTable columns={columns} data={users} pageSize={50} globalFilterPlaceholder="Filter users…" />;
}
