/**
 * GET /api/meta
 *
 * Returns metadata for filter dropdowns: list of users and distinct models.
 * Uses service role key (server-only) -- bypasses RLS.
 *
 * Response: { users: User[], models: string[] }
 */

import { getSupabaseServerClient, isServiceRoleConfigured } from "@/lib/supabase/client";

export async function GET() {
  if (!isServiceRoleConfigured()) {
    return Response.json({ error: "Supabase not configured" }, { status: 503 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const [usersResult, modelsResult] = await Promise.all([
      supabase
        .from("users")
        .select("id,display_name,account_type,slug")
        .is("deleted_at", null)
        .order("display_name"),
      supabase
        .from("usage_events")
        .select("model")
        .order("model"),
    ]);

    if (usersResult.error) {
      return Response.json({ error: usersResult.error.message }, { status: 500 });
    }

    const models = [...new Set((modelsResult.data as any[] ?? []).map((r) => r.model))].sort();

    return Response.json(
      { users: (usersResult.data ?? []) as any[], models },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/meta] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
