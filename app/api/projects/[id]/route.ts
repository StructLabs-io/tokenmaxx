/**
 * /api/projects/[id]
 *
 * GET  — project detail with daily timeline, model breakdown, recent events
 *        [id] is interpreted as a project slug
 * PATCH — update mutable fields: display_name, client, billable
 *         [id] is the project UUID
 *
 * Uses service role key (server-only) — bypasses RLS.
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import type { DailyTotal, UsageEventRow } from "@/lib/supabase/types";

export interface ProjectDetail {
  id: string;
  slug: string;
  display_name: string;
  client: string | null;
  toggl_project_id: number | null;
  billable: boolean;
  totalTokens: number;
  totalCost: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  dailyTotals: DailyTotal[];
  byModel: { model: string; tokens: number; cost: number | null }[];
  recentEvents: UsageEventRow[];
  totalEvents: number;
}

interface PatchProjectBody {
  display_name?: string;
  client?: string | null;
  billable?: boolean;
}

// GET /api/projects/[id] — id treated as slug for lookups
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { id: slug } = await params;

  try {
    const supabase = getSupabaseServerClient();

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,slug,display_name,client,toggl_project_id,billable")
      .eq("slug", slug)
      .is("deleted_at", null)
      .single() as { data: any; error: any };

    if (projectError || !project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const { data: events, error: eventsError, count } = await supabase
      .from("usage_events")
      .select(
        "id,captured_at,date_utc,user_id,model,provider,capture_method,input_tokens,output_tokens,total_tokens,cost_usd,session_id",
        { count: "exact" }
      )
      .eq("project_id", (project as any).id)
      .order("captured_at", { ascending: false }) as { data: any[] | null; error: any; count: number | null };

    if (eventsError) {
      console.error("[/api/projects/[id] GET] Events query error:", eventsError);
      return Response.json({ error: eventsError.message }, { status: 500 });
    }

    const allEvents = (events as any[] ?? []);

    const byDate = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of allEvents as any[]) {
      const existing = byDate.get(e.date_utc) ?? { tokens: 0, cost: null };
      byDate.set(e.date_utc, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + (e.cost_usd as number) : existing.cost,
      });
    }
    const dailyTotals: DailyTotal[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { tokens, cost }]) => ({ date, tokens, cost }));

    const byModel = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of allEvents as any[]) {
      const existing = byModel.get(e.model) ?? { tokens: 0, cost: null };
      byModel.set(e.model, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null ? (existing.cost ?? 0) + (e.cost_usd as number) : existing.cost,
      });
    }
    const modelBreakdown = Array.from(byModel.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.tokens - a.tokens);

    const recentRaw = (allEvents as any[]).slice(0, 20);
    const userIds = [...new Set(recentRaw.map((e) => e.user_id))];
    const { data: users } = userIds.length > 0
      ? await supabase.from("users").select("id,display_name").in("id", userIds)
      : { data: [] };
    const userMap = new Map(((users ?? []) as any[]).map((u) => [u.id, u.display_name]));

    const recentEvents: UsageEventRow[] = recentRaw.map((e: any) => ({
      id: e.id,
      captured_at: e.captured_at,
      date_utc: e.date_utc,
      user_id: e.user_id,
      user_display_name: userMap.get(e.user_id) ?? null,
      project_id: (project as any).id,
      project_display_name: (project as any).display_name,
      model: e.model,
      provider: e.provider,
      capture_method: e.capture_method,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      total_tokens: e.total_tokens,
      cost_usd: e.cost_usd,
      session_id: e.session_id,
    }));

    const totalTokens = (allEvents as any[]).reduce((s, e) => s + (e.total_tokens ?? 0), 0);
    const hasCost = (allEvents as any[]).some((e) => e.cost_usd != null);
    const totalCost = hasCost
      ? (allEvents as any[]).reduce((s, e) => s + ((e.cost_usd ?? 0) as number), 0)
      : null;

    const detail: ProjectDetail = {
      id: (project as any).id,
      slug: (project as any).slug,
      display_name: (project as any).display_name,
      client: (project as any).client,
      toggl_project_id: (project as any).toggl_project_id,
      billable: (project as any).billable,
      totalTokens,
      totalCost,
      totalInputTokens: allEvents.reduce((s, e) => s + (e.input_tokens ?? 0), 0),
      totalOutputTokens: allEvents.reduce((s, e) => s + (e.output_tokens ?? 0), 0),
      dailyTotals,
      byModel: modelBreakdown,
      recentEvents,
      totalEvents: count ?? allEvents.length,
    };

    return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[/api/projects/[id] GET] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/projects/[id] — id is a project UUID
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing project id" }, { status: 400 });
  }

  let body: PatchProjectBody;
  try {
    body = await req.json() as PatchProjectBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.display_name !== undefined) update.display_name = body.display_name.trim();
  if (body.client !== undefined) update.client = body.client?.trim() || null;
  if (body.billable !== undefined) update.billable = body.billable;

  if (Object.keys(update).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await (supabase
      .from("projects") as any)
      .update(update)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,slug,display_name,client,billable,active,created_at")
      .single() as { data: any | null; error: any };

    if (error) {
      console.error("[/api/projects/[id] PATCH] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    return Response.json(data);
  } catch (err) {
    console.error("[/api/projects/[id] PATCH] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
