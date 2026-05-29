/**
 * /api/projects
 *
 * GET  — Returns all active projects with rolled-up token/cost totals.
 *         Query params: days=30 (lookback, default 30, max 365)
 *
 * POST — Creates a new project.
 *         Body: { display_name, slug, client?, billable }
 *
 * Uses service role key (server-only) -- bypasses RLS.
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";
import type { ProjectTotals, CreateProjectInput } from "@/lib/supabase/types";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export async function GET(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(
    parseInt(searchParams.get("days") ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS,
    MAX_DAYS
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  try {
    const supabase = getSupabaseServerClient();

    // Fetch all active projects
    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id,slug,display_name,client,billable,active,created_at,deleted_at")
      .is("deleted_at", null)
      .order("display_name", { ascending: true }) as {
      data: any[] | null;
      error: any;
    };

    if (projectsError) {
      console.error("[/api/projects] Projects query error:", projectsError);
      return Response.json({ error: projectsError.message }, { status: 500 });
    }

    if (!projects || projects.length === 0) {
      return Response.json([]);
    }

    // Fetch token/cost aggregates for the period
    const projectIds = (projects as any[]).map((p) => p.id);
    const { data: events, error: eventsError } = await supabase
      .from("usage_events")
      .select("project_id,total_tokens,cost_usd")
      .in("project_id", projectIds)
      .gte("date_utc", cutoffDate) as {
      data: any[] | null;
      error: any;
    };

    if (eventsError) {
      console.error("[/api/projects] Events query error:", eventsError);
      return Response.json({ error: eventsError.message }, { status: 500 });
    }

    // Aggregate by project
    const byProject = new Map<string, { tokens: number; cost: number | null }>();
    for (const e of events ?? []) {
      if (!e.project_id) continue;
      const existing = byProject.get(e.project_id) ?? { tokens: 0, cost: null };
      byProject.set(e.project_id, {
        tokens: existing.tokens + (e.total_tokens ?? 0),
        cost: e.cost_usd != null
          ? (existing.cost ?? 0) + e.cost_usd
          : existing.cost,
      });
    }

    const result: ProjectTotals[] = projects.map((p) => {
      const totals = byProject.get(p.id);
      return {
        id: p.id,
        slug: p.slug,
        display_name: p.display_name,
        client: p.client,
        totalTokens: totals?.tokens ?? 0,
        totalCost: totals?.cost ?? null,
      };
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/projects] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---- POST ---------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  let body: CreateProjectInput;
  try {
    body = await req.json() as CreateProjectInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { display_name, slug, client, billable } = body;
  if (!display_name?.trim() || !slug?.trim()) {
    return Response.json(
      { error: "Missing required fields: display_name, slug" },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabaseServerClient();

    // Resolve workspace_id from any existing project (single-tenant assumption)
    const { data: existing } = await supabase
      .from("projects")
      .select("workspace_id")
      .limit(1)
      .single() as { data: any | null };

    if (!existing?.workspace_id) {
      return Response.json({ error: "No workspace found" }, { status: 422 });
    }

    const { data: inserted, error } = await (supabase
      .from("projects") as any)
      .insert({
        workspace_id: existing.workspace_id,
        display_name: display_name.trim(),
        slug: slug.trim(),
        client: client?.trim() || null,
        billable: billable ?? true,
        active: true,
        deleted_at: null,
      })
      .select("id,slug,display_name,client,billable,active,created_at")
      .single() as { data: any | null; error: any };

    if (error) {
      console.error("[/api/projects POST] Supabase error:", error);
      const msg = error.code === "23505"
        ? "A project with that slug already exists"
        : error.message;
      return Response.json({ error: msg }, { status: 409 });
    }

    return Response.json(inserted, { status: 201 });
  } catch (err) {
    console.error("[/api/projects POST] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
