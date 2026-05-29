/**
 * GET /api/projects/[slug]
 *
 * Returns project detail with daily timeline, model breakdown, and recent events.
 * Uses service role key (server-only) -- bypasses RLS.
 *
 * Response: ProjectDetail JSON
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { slug } = await params;

  try {
    const supabase = getSupabaseServerClient();

    // Look up project by slug
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,slug,display_name,client,toggl_project_id,billable")
      .eq("slug", slug)
      .is("deleted_at", null)
      .single() as { data: any; error: any };

    if (projectError || !project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    // Fetch all events for this project
    const { data: events, error: eventsError, count } = await supabase
      .from("usage_events")
      .select(
        "id,captured_at,date_utc,user_id,model,provider,capture_method,input_tokens,output_tokens,total_tokens,cost_usd,session_id",
        { count: "exact" }
      )
      .eq("project_id", (project as any).id)
      .order("captured_at", { ascending: false }) as { data: any[] | null; error: any; count: number | null };

    if (eventsError) {
      console.error("[/api/projects/[slug]] Events query error:", eventsError);
      return Response.json({ error: eventsError.message }, { status: 500 });
    }

    const allEvents = (events as any[] ?? []);

    // Aggregate daily totals
    const byDate = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of allEvents as any[]) {
      const existing = byDate.get(e.date_utc) ?? { tokens: 0, cost: null };
      byDate.set(e.date_utc, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null
          ? (existing.cost ?? 0) + (e.cost_usd as number)
          : existing.cost,
      });
    }
    const dailyTotals: DailyTotal[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { tokens, cost }]) => ({ date, tokens, cost }));

    // Aggregate by model
    const byModel = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of allEvents as any[]) {
      const existing = byModel.get(e.model) ?? { tokens: 0, cost: null };
      byModel.set(e.model, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null
          ? (existing.cost ?? 0) + (e.cost_usd as number)
          : existing.cost,
      });
    }
    const modelBreakdown = Array.from(byModel.entries())
      .map(([model, data]) => ({ model, ...data }))
      .sort((a, b) => b.tokens - a.tokens);

    // Get user display names for recent events
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

    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/projects/[slug]] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
