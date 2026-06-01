/**
 * /users -- Workspace user list with account type badges and 30d token/cost totals
 *
 * Server Component: fetches user summary from lib/data.ts (getUsersSummary).
 * Falls back to seed data when Supabase is not configured.
 */

import { getUsersSummary } from "@/lib/data";
import { UsersClient } from "./client";
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

export default async function UsersPage() {
  const { users, totalHuman, totalService, totalTokens, usingSeedData } =
    await getUsersSummary(30);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Workspace members and service accounts (30-day usage)
          </p>
        </div>
        <Badge
          variant={usingSeedData ? "secondary" : "outline"}
          className="text-xs"
        >
          {usingSeedData ? "Seed data" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
        </Badge>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total users</p>
            <p className="text-2xl font-bold">{users.length}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Human</p>
            <p className="text-2xl font-bold">{totalHuman}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Service accounts</p>
            <p className="text-2xl font-bold">{totalService}</p>
          </CardHeader>
        </Card>
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <p className="text-xs text-muted-foreground">Total tokens (30d)</p>
            <p className="text-2xl font-bold tabular-nums">{formatTokens(totalTokens)}</p>
          </CardHeader>
        </Card>
      </div>

      {/* Users table */}
      <Card>
        <CardHeader className="px-6">
          <CardTitle className="text-sm font-medium">All users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersClient users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
