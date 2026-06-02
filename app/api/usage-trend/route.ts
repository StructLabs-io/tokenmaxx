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
import { fetchAll, isDemoMode } from "@/lib/data";
import { SEED_USAGE_EVENTS } from "@/lib/seed-data";

export const dynamic = "force-dynamic";

type Bucket = { label: string; tokens: number; cost: number };

function clampInt(s: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(s ?? "", 10);
  if (Number.isFinite(n)) return Math.min(Math.max(n, min), max);
  return fallback;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const daysParam = params.get("days");
  const groupBy = params.get("group_by");
  const granularityParam = params.get("granularity");
  const userIdFilter = params.get("user_id");
  const modelFilter = params.get("model");

  if (isDemoMode()) {
    const { demoEvents } = await import("@/demo/demo-mode-flag");
    return Response.json(seedBuckets({
      from, to, daysParam, granularityParam, userIdFilter, modelFilter, groupBy,
    }, demoEvents() as any[]));
  }

  if (!isServiceRoleConfigured()) {
    return Response.json(seedBuckets({
      from, to, daysParam, granularityParam, userIdFilter, modelFilter, groupBy,
    }, SEED_USAGE_EVENTS as any[]));
  }

  try {
    const supabase = getSupabaseServerClient();

    // §2.5/§2.6 — route both granularity and group_by through SQL RPCs.
    // RPCs don't accept user/model filters; fall back to the direct-query path when filters are set.
    if ((groupBy || granularityParam) && !userIdFilter && !modelFilter) {
      const days = clampInt(daysParam, 14, 1, 365);
      const fromIso = from ? new Date(from + "T00:00:00Z").toISOString()
                           : new Date(Date.now() - (days - 1) * 86400000).toISOString();
      const toIso = to ? new Date(to + "T23:59:59Z").toISOString()
                       : new Date().toISOString();
      const gran = granularityParam ?? (days === 1 ? "hour" : "day");
      if (groupBy) {
        const { data, error } = await (supabase as any).rpc("fn_usage_buckets_grouped", {
          p_from: fromIso, p_to: toIso, p_granularity: gran, p_group_by: groupBy,
        });
        if (error) return Response.json({ buckets: [], series: [], granularity: gran, error: String(error.message) }, { status: 500 });
        return Response.json(data ?? { buckets: [], series: [], granularity: gran });
      } else {
        const { data, error } = await (supabase as any).rpc("fn_usage_buckets", {
          p_from: fromIso, p_to: toIso, p_granularity: gran,
        });
        if (error) return Response.json({ buckets: [], granularity: gran, error: String(error.message) }, { status: 500 });
        return Response.json(data ?? { buckets: [], granularity: gran });
      }
    }

    // Custom range path
    if (from && to) {
      const events = await fetchAll<{ date_utc: string; total_tokens: number; cost_usd: number | null }>(
        (a, b) => {
          let q = supabase
            .from("usage_events")
            .select("date_utc,total_tokens,cost_usd")
            .gte("date_utc", from)
            .lte("date_utc", to);
          if (userIdFilter) q = q.eq("user_id", userIdFilter);
          if (modelFilter) q = q.eq("model", modelFilter);
          return q
            .order("date_utc", { ascending: true })
            .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>;
        },
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
        (a, b) => {
          let q = supabase
            .from("usage_events")
            .select("captured_at,total_tokens,cost_usd")
            .gte("captured_at", cutoffIso);
          if (userIdFilter) q = q.eq("user_id", userIdFilter);
          if (modelFilter) q = q.eq("model", modelFilter);
          return q
            .order("captured_at", { ascending: true })
            .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>;
        },
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
      (a, b) => {
        let q = supabase
          .from("usage_events")
          .select("date_utc,total_tokens,cost_usd")
          .gte("date_utc", cutoffDate);
        if (userIdFilter) q = q.eq("user_id", userIdFilter);
        if (modelFilter) q = q.eq("model", modelFilter);
        return q
          .order("date_utc", { ascending: true })
          .range(a, b) as unknown as Promise<{ data: any[] | null; error: any }>;
      },
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

function seedBuckets(opts: {
  from: string | null;
  to: string | null;
  daysParam: string | null;
  granularityParam: string | null;
  userIdFilter: string | null;
  modelFilter: string | null;
  groupBy: string | null;
}, source: any[]): any {
  const { from, to, daysParam, granularityParam, userIdFilter, modelFilter, groupBy } = opts;

  let events = source;
  if (userIdFilter) events = events.filter((e) => e.user_id === userIdFilter);
  if (modelFilter) events = events.filter((e) => e.model === modelFilter);

  // Resolve effective window
  let fromDate: string;
  let toDate: string;
  let gran: "hour" | "day";
  if (from && to) {
    fromDate = from;
    toDate = to;
    gran = (granularityParam as any) ?? "day";
  } else {
    const days = clampInt(daysParam, 14, 1, 365);
    gran = (granularityParam as any) ?? (days === 1 ? "hour" : "day");
    if (gran === "hour") {
      const now = new Date();
      const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
      events = events.filter((e) => new Date(e.captured_at).getTime() >= cutoffMs);
      if (groupBy) {
        return groupedHourlyFromSeed(events, now, groupBy);
      }
      return { buckets: aggregateHourly(events, now), granularity: "hour" };
    }
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    fromDate = cutoff.toISOString().slice(0, 10);
    toDate = new Date().toISOString().slice(0, 10);
  }

  events = events.filter((e) => e.date_utc >= fromDate && e.date_utc <= toDate);

  if (groupBy) {
    return groupedDailyFromSeed(events, fromDate, toDate, groupBy);
  }

  if (gran === "hour") {
    return { buckets: aggregateHourly(events, new Date(toDate + "T23:59:59Z")), granularity: "hour" };
  }
  return { buckets: aggregateDaily(events, fromDate, toDate), granularity: "day" };
}

function seedSeriesKey(e: any, groupBy: string): string {
  switch (groupBy) {
    case "model": return e.model ?? "unknown";
    case "project": return e.project_id ?? "unattributed";
    case "user": return e.user_id ?? "unknown";
    case "provider": return e.provider ?? "unknown";
    case "source": return e.capture_method ?? "unknown";
    default: return "all";
  }
}

function groupedDailyFromSeed(
  events: any[],
  fromDate: string,
  toDate: string,
  groupBy: string,
): { buckets: any[]; series: string[]; granularity: "day" } {
  const seriesSet = new Set<string>();
  const byDate = new Map<string, Map<string, { tokens: number; cost: number }>>();
  for (const e of events) {
    const key = seedSeriesKey(e, groupBy);
    seriesSet.add(key);
    const day = byDate.get(e.date_utc) ?? new Map();
    const cur = day.get(key) ?? { tokens: 0, cost: 0 };
    day.set(key, {
      tokens: cur.tokens + (e.total_tokens ?? 0),
      cost: cur.cost + (e.cost_usd ?? 0),
    });
    byDate.set(e.date_utc, day);
  }
  const series = [...seriesSet];
  const buckets: any[] = [];
  let d = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    const iso = d.toISOString().slice(0, 10);
    const day = byDate.get(iso);
    const row: any = { label: iso, series: {} };
    for (const s of series) {
      row.series[s] = day?.get(s) ?? { tokens: 0, cost: 0 };
    }
    buckets.push(row);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { buckets, series, granularity: "day" };
}

function groupedHourlyFromSeed(
  events: any[],
  now: Date,
  groupBy: string,
): { buckets: any[]; series: string[]; granularity: "hour" } {
  const seriesSet = new Set<string>();
  const byHour = new Map<string, Map<string, { tokens: number; cost: number }>>();
  for (const e of events) {
    const key = seedSeriesKey(e, groupBy);
    seriesSet.add(key);
    const hourKey = `${new Date(e.captured_at).toISOString().slice(0, 13)}:00`;
    const hour = byHour.get(hourKey) ?? new Map();
    const cur = hour.get(key) ?? { tokens: 0, cost: 0 };
    hour.set(key, {
      tokens: cur.tokens + (e.total_tokens ?? 0),
      cost: cur.cost + (e.cost_usd ?? 0),
    });
    byHour.set(hourKey, hour);
  }
  const series = [...seriesSet];
  const buckets: any[] = [];
  const endHour = new Date(now);
  endHour.setUTCMinutes(0, 0, 0);
  for (let i = 23; i >= 0; i--) {
    const h = new Date(endHour.getTime() - i * 60 * 60 * 1000);
    const key = `${h.toISOString().slice(0, 13)}:00`;
    const hour = byHour.get(key);
    const row: any = { label: key, series: {} };
    for (const s of series) {
      row.series[s] = hour?.get(s) ?? { tokens: 0, cost: 0 };
    }
    buckets.push(row);
  }
  return { buckets, series, granularity: "hour" };
}
