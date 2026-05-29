/**
 * GET /api/users
 *
 * Returns all active users with rolled-up token/cost totals for the given period.
 * Uses service role key (server-only) -- bypasses RLS.
 *
 * Query params:
 *   days=30  (lookback window, default 30, max 365)
 *
 * Response: { users: UserSummaryRow[], totalHuman, totalService, totalTokens }
 */

import { NextRequest } from "next/server";
import { getUsersSummary } from "@/lib/data";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(
    parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS,
    MAX_DAYS
  );

  const result = await getUsersSummary(days);

  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
