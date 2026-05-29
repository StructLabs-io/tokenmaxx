/**
 * PATCH /api/projects/[id]
 *
 * Updates a project's mutable fields: display_name, client, billable.
 * Slug is immutable after creation (foreign key considerations).
 *
 * Body: { display_name?, client?, billable? }
 *
 * Uses service role key (server-only) -- bypasses RLS.
 */

import { NextRequest } from "next/server";
import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";

interface PatchProjectBody {
  display_name?: string;
  client?: string | null;
  billable?: boolean;
}

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
      console.error("[/api/projects PATCH] Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    return Response.json(data);
  } catch (err) {
    console.error("[/api/projects PATCH] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
