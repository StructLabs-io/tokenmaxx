import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Defence-in-depth check for write endpoints. The middleware already gates
 * `/api/*`, but the matcher is an exclusion regex — one mis-edit could open
 * a route. Service-role-backed writes call this first so a misconfigured
 * matcher fails closed instead of open.
 *
 * Returns `null` on success, or a `Response` to short-circuit on failure.
 */
export async function requireAllowedUser(): Promise<Response | null> {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowed = (process.env.TOKENMAXX_ALLOWED_EMAIL ?? "ben@structlabs.io").toLowerCase();
  if (!user.email || user.email.toLowerCase() !== allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
