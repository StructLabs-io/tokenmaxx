/**
 * /users -- Workspace user list with account type badges and 30d token/cost totals
 *
 * Server Component: fetches user summary from lib/data.ts (getUsersSummary).
 * Falls back to seed data when Supabase is not configured.
 */

import { getUsersSummary } from "@/lib/data";
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
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="hidden md:table-cell">Timezone</TableHead>
                <TableHead className="text-right">Tokens (30d)</TableHead>
                <TableHead className="text-right pr-6">Cost (30d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="pl-6 text-muted-foreground text-sm">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="pl-6">
                      <div className="flex flex-col">
                        <span className="font-medium">{user.display_name}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {user.slug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.account_type === "service" ? (
                        <Badge
                          variant="secondary"
                          className="text-xs font-normal"
                        >
                          Service
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-xs font-normal bg-blue-500/10 text-blue-400 border-blue-500/30"
                        >
                          Human
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {user.email ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {user.default_timezone}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatTokens(user.total_tokens)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums pr-6">
                      {user.cost_usd != null ? formatCost(user.cost_usd) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
