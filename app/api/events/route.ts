/**
 * GET /api/events
 *
 * Paginated usage_events with optional filters.
 * Uses service role key (server-only) -- bypasses RLS.
 *
 * Query params:
 *   page=0          (0-indexed, default 0)
 *   pageSize=25     (default 25, max 100)
 *   user=<user_id>  (optional filter)
 *   model=<model>   (optional filter)
 *   project=<id>    (optional; "unattributed" for null project_id)
 *   q=<text>        (optional; searches model, capture_method, session_id)
 *
 * Response: EventsPage JSON
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/data";
import { SEED_USAGE_EVENTS, SEED_USERS, SEED_PROJECTS } from "@/lib/seed-data";
import type { EventsPage, UsageEventRow } from "@/lib/supabase/types";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") ?? "0", 10) || 0;
  const pageSize = Math.min(
    parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const filterUser = searchParams.get("user") ?? null;
  const filterModel = searchParams.get("model") ?? null;
  const filterProject = searchParams.get("project") ?? null;
  const filterFrom = searchParams.get("from"); // YYYY-MM-DD
  const filterTo = searchParams.get("to");     // YYYY-MM-DD

  if (isDemoMode()) {
    const { demoUsageEvents, demoFilterOptions } = await import("@/demo/demo-mode-flag");
    const r = demoUsageEvents({
      limit: pageSize,
      offset: page * pageSize,
      userId: filterUser ?? undefined,
      model: filterModel ?? undefined,
      from: filterFrom ?? undefined,
      to: filterTo ?? undefined,
      projectId: filterProject === "unattributed" ? null : (filterProject ?? undefined),
    });
    const opts = demoFilterOptions();
    const rows: UsageEventRow[] = r.events.map((e: any) => ({
      id: e.id,
      captured_at: e.captured_at,
      date_utc: e.date_utc,
      user_id: e.user_id,
      user_display_name: opts.userNames.get(e.user_id) ?? null,
      project_id: e.project_id,
      project_display_name: e.project_id ? (opts.projectNames.get(e.project_id) ?? null) : null,
      model: e.model,
      provider: e.provider,
      capture_method: e.capture_method,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      total_tokens: e.total_tokens,
      cost_usd: e.cost_usd,
      session_id: e.session_id,
    }));
    return Response.json({ events: rows, total: r.total, page, pageSize } satisfies EventsPage, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!isServiceRoleConfigured()) {
    return Response.json(seedEventsPage({
      page, pageSize, filterUser, filterModel, filterProject, filterFrom, filterTo,
    }), { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const supabase = getSupabaseServerClient();

    let query = supabase
      .from("usage_events")
      .select(
        "id,captured_at,date_utc,user_id,project_id,model,provider,capture_method,input_tokens,output_tokens,total_tokens,cost_usd,session_id",
        { count: "exact" }
      )
      .order("captured_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (filterUser) query = query.eq("user_id", filterUser);
    if (filterModel) query = query.eq("model", filterModel);
    if (filterProject === "unattributed") {
      query = query.is("project_id", null);
    } else if (filterProject) {
      query = query.eq("project_id", filterProject);
    }
    if (filterFrom) query = query.gte("date_utc", filterFrom);
    if (filterTo) query = query.lte("date_utc", filterTo);

    const { data: events, error, count } = await query as {
      data: any[] | null;
      error: any;
      count: number | null;
    };

    if (error) {
      console.error("[/api/events] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Fetch user and project display names for the events on this page
    const userIds = [...new Set((events ?? []).map((e) => e.user_id))];
    const projectIds = [...new Set((events ?? []).map((e) => e.project_id).filter(Boolean))] as string[];

    const [usersResult, projectsResult] = await Promise.all([
      userIds.length > 0
        ? supabase.from("users").select("id,display_name").in("id", userIds)
        : Promise.resolve({ data: [] }),
      projectIds.length > 0
        ? supabase.from("projects").select("id,display_name").in("id", projectIds)
        : Promise.resolve({ data: [] }),
    ]);

    const userMap = new Map(
      (usersResult.data as any[] ?? []).map((u) => [u.id, u.display_name])
    );
    const projectMap = new Map(
      (projectsResult.data as any[] ?? []).map((p) => [p.id, p.display_name])
    );

    const rows: UsageEventRow[] = (events ?? []).map((e) => ({
      id: e.id,
      captured_at: e.captured_at,
      date_utc: e.date_utc,
      user_id: e.user_id,
      user_display_name: userMap.get(e.user_id) ?? null,
      project_id: e.project_id,
      project_display_name: e.project_id ? (projectMap.get(e.project_id) ?? null) : null,
      model: e.model,
      provider: e.provider,
      capture_method: e.capture_method,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      total_tokens: e.total_tokens,
      cost_usd: e.cost_usd,
      session_id: e.session_id,
    }));

    const response: EventsPage = {
      events: rows,
      total: count ?? 0,
      page,
      pageSize,
    };

    return Response.json(response, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/events] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

function seedEventsPage(opts: {
  page: number;
  pageSize: number;
  filterUser: string | null;
  filterModel: string | null;
  filterProject: string | null;
  filterFrom: string | null;
  filterTo: string | null;
}): EventsPage {
  const { page, pageSize, filterUser, filterModel, filterProject, filterFrom, filterTo } = opts;

  const userMap = new Map(SEED_USERS.map((u) => [u.id, u.display_name]));
  const projectMap = new Map(SEED_PROJECTS.map((p) => [p.id, p.display_name]));

  let events = [...SEED_USAGE_EVENTS].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
  );
  if (filterUser) events = events.filter((e) => e.user_id === filterUser);
  if (filterModel) events = events.filter((e) => e.model === filterModel);
  if (filterProject === "unattributed") {
    events = events.filter((e) => !e.project_id);
  } else if (filterProject) {
    events = events.filter((e) => e.project_id === filterProject);
  }
  if (filterFrom) events = events.filter((e) => e.date_utc >= filterFrom);
  if (filterTo) events = events.filter((e) => e.date_utc <= filterTo);

  const total = events.length;
  const slice = events.slice(page * pageSize, (page + 1) * pageSize);

  const rows: UsageEventRow[] = slice.map((e) => ({
    id: e.id,
    captured_at: e.captured_at,
    date_utc: e.date_utc,
    user_id: e.user_id,
    user_display_name: userMap.get(e.user_id) ?? null,
    project_id: e.project_id,
    project_display_name: e.project_id ? (projectMap.get(e.project_id) ?? null) : null,
    model: e.model,
    provider: e.provider,
    capture_method: e.capture_method,
    input_tokens: e.input_tokens,
    output_tokens: e.output_tokens,
    total_tokens: e.total_tokens,
    cost_usd: e.cost_usd,
    session_id: e.session_id,
  }));

  return { events: rows, total, page, pageSize };
}
