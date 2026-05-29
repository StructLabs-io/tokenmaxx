/**
 * /api/reconcile
 *
 * GET  — Returns up to 100 most-recent unattributed event groups
 *         (grouped by date_utc + model + capture_method).
 *
 * POST — Applies a project attribution override:
 *         { date_utc, model, capture_method, project_id }
 *         → UPDATE usage_events SET project_id = ? WHERE ... AND project_id IS NULL
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";

export interface UnattributedGroup {
  date_utc: string;
  model: string;
  capture_method: string;
  event_count: number;
  total_tokens: number;
  total_cost: number | null;
}

// ---- GET ---------------------------------------------------------------

export async function GET() {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("usage_events")
      .select("date_utc,model,capture_method,total_tokens,cost_usd")
      .is("project_id", null)
      .order("date_utc", { ascending: false })
      .limit(500) as { data: any[] | null; error: any };

    if (error) {
      console.error("[/api/reconcile GET] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // Group by date_utc + model + capture_method
    const map = new Map<string, UnattributedGroup>();
    for (const r of rows) {
      const key = `${r.date_utc}|${r.model}|${r.capture_method}`;
      const existing = map.get(key);
      if (existing) {
        existing.event_count += 1;
        existing.total_tokens += r.total_tokens ?? 0;
        if (r.cost_usd != null) {
          existing.total_cost = (existing.total_cost ?? 0) + r.cost_usd;
        }
      } else {
        map.set(key, {
          date_utc: r.date_utc,
          model: r.model,
          capture_method: r.capture_method,
          event_count: 1,
          total_tokens: r.total_tokens ?? 0,
          total_cost: r.cost_usd ?? null,
        });
      }
    }

    // Return top 100 groups by date desc
    const groups = Array.from(map.values())
      .sort((a, b) => b.date_utc.localeCompare(a.date_utc))
      .slice(0, 100);

    return Response.json(groups, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/reconcile GET] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---- POST ---------------------------------------------------------------

interface AttributionPayload {
  date_utc: string;
  model: string;
  capture_method: string;
  project_id: string;
}

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  let body: AttributionPayload;
  try {
    body = await req.json() as AttributionPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { date_utc, model, capture_method, project_id } = body;
  if (!date_utc || !model || !capture_method || !project_id) {
    return Response.json(
      { error: "Missing required fields: date_utc, model, capture_method, project_id" },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    const { error, count } = await (supabase
      .from("usage_events") as any)
      .update({ project_id })
      .eq("date_utc", date_utc)
      .eq("model", model)
      .eq("capture_method", capture_method)
      .is("project_id", null)
      .select("id", { count: "exact", head: true }) as { error: any; count: number | null };

    if (error) {
      console.error("[/api/reconcile POST] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ updated: count ?? 0 });
  } catch (err) {
    console.error("[/api/reconcile POST] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
