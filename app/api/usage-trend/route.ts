/**
 * GET /api/usage-trend
 *
 * Returns time-bucketed token + cost totals for the dashboard trend chart.
 *
 * Query params:
 *   ?days=N            — last N days (rolling); 1 day uses hourly buckets, ≥3 uses daily
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD — custom range (daily buckets)
 *
 * Response: { buckets: [{ label, tokens, cost }], granularity }
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/data";

export const dynamic = "force-dynamic";

type Bucket = { label: string; tokens: number; cost: number };

function clampInt(s: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(s ?? "", 10);
  if (Number.isFinite(n)) return Math.min(Math.max(n, min), max);
  return fallback;
}

export async function GET(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ buckets: [], granularity: "day" });
  }
  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const daysParam = params.get("days");

  try {
    const supabase = getSupabaseServerClient();

    // Custom range path
    if (from && to) {
      const events = await fetchAll<{ date_utc: string; total_tokens: number; cost_usd: number | null }>(
        (a, b) =>
          supabase
            .from("usage_events")
            .select("date_utc,total_tokens,cost_usd")
            .gte("date_utc", from)
            .lte("date_utc", to)
            .order("date_utc", { ascending: true })
            .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>,
      );
      const buckets = aggregateDaily(events, from, to);
      return Response.json({ buckets, granularity: "day" });
    }

    const days = clampInt(daysParam, 14, 1, 365);

    // 1-day path — hourly buckets in user's local TZ (default MYT for the seed workspace)
    if (days === 1) {
      const now = new Date();
      const cutoffIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const events = await fetchAll<{ captured_at: string; total_tokens: number; cost_usd: number | null }>(
        (a, b) =>
          supabase
            .from("usage_events")
            .select("captured_at,total_tokens,cost_usd")
            .gte("captured_at", cutoffIso)
            .order("captured_at", { ascending: true })
            .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>,
      );
      const buckets = aggregateHourly(events, now);
      return Response.json({ buckets, granularity: "hour" });
    }

    // N-day path — daily buckets
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const todayDate = new Date().toISOString().slice(0, 10);
    const events = await fetchAll<{ date_utc: string; total_tokens: number; cost_usd: number | null }>(
      (a, b) =>
        supabase
          .from("usage_events")
          .select("date_utc,total_tokens,cost_usd")
          .gte("date_utc", cutoffDate)
          .order("date_utc", { ascending: true })
          .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>,
    );
    const buckets = aggregateDaily(events, cutoffDate, todayDate);
    return Response.json({ buckets, granularity: "day" });
  } catch (err) {
    console.error("[/api/usage-trend] error:", err);
    return Response.json({ buckets: [], granularity: "day", error: String(err) }, { status: 500 });
  }
}

function aggregateDaily(
  events: { date_utc: string; total_tokens: number; cost_usd: number | null }[],
  fromDate: string,
  toDate: string,
): Bucket[] {
  const byDate = new Map<string, { tokens: number; cost: number }>();
  for (const e of events) {
    const existing = byDate.get(e.date_utc) ?? { tokens: 0, cost: 0 };
    byDate.set(e.date_utc, {
      tokens: existing.tokens + (e.total_tokens ?? 0),
      cost: existing.cost + (e.cost_usd ?? 0),
    });
  }
  // Fill in any zero days in the range so the chart axis stays contiguous
  const out: Bucket[] = [];
  let d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const iso = d.toISOString().slice(0, 10);
    const v = byDate.get(iso) ?? { tokens: 0, cost: 0 };
    out.push({ label: iso, tokens: v.tokens, cost: v.cost });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function aggregateHourly(
  events: { captured_at: string; total_tokens: number; cost_usd: number | null }[],
  now: Date,
): Bucket[] {
  // Produce 24 hourly buckets, ending at the current hour
  const byHour = new Map<string, { tokens: number; cost: number }>();
  for (const e of events) {
    const d = new Date(e.captured_at);
    const key = `${d.toISOString().slice(0, 13)}:00`; // YYYY-MM-DDTHH:00
    const existing = byHour.get(key) ?? { tokens: 0, cost: 0 };
    byHour.set(key, {
      tokens: existing.tokens + (e.total_tokens ?? 0),
      cost: existing.cost + (e.cost_usd ?? 0),
    });
  }
  const out: Bucket[] = [];
  const endHour = new Date(now);
  endHour.setUTCMinutes(0, 0, 0);
  for (let i = 23; i >= 0; i--) {
    const h = new Date(endHour.getTime() - i * 60 * 60 * 1000);
    const key = `${h.toISOString().slice(0, 13)}:00`;
    const v = byHour.get(key) ?? { tokens: 0, cost: 0 };
    out.push({ label: key, tokens: v.tokens, cost: v.cost });
  }
  return out;
}
