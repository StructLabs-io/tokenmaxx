/**
 * Supabase clients for Tokenmaxx.
 *
 * Two clients:
 *   getSupabaseClient()       -- browser-safe, anon key, for future auth'd reads
 *   getSupabaseServerClient() -- server-only, service role key, bypasses RLS
 *
 * Architecture decision: v0.1 dashboard has no auth UI. All data reads use
 * the service role key server-side via Route Handlers. The anon key client
 * is scaffolded for v0.2 when Supabase Auth is added.
 *
 * CRITICAL: Never call getSupabaseServerClient() from browser-side code.
 * It holds the service role key. Keep it in Route Handlers and RSC only.
 *
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured, isServiceRoleConfigured } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Singleton for browser-side client (anon key)
let _browserClient: SupabaseClient<Database> | null = null;

/**
 * Returns a browser-safe Supabase client using the anon key.
 * RLS is the access control layer -- never expose service-role key here.
 *
 * Throws if Supabase is not yet configured (placeholder env vars).
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "[Supabase] Not configured. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect. " +
        "The dashboard is running in seed-data mode until these are provided."
    );
  }

  if (!_browserClient) {
    _browserClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      }
    );
  }

  return _browserClient;
}

/**
 * Returns a server-only Supabase client using the service role key.
 * Bypasses RLS -- use ONLY in Route Handlers and RSC, never in browser code.
 *
 * Each call creates a new client instance (no singleton) because service-role
 * clients should not be cached across requests in edge environments.
 *
 * Throws if service role key is not configured.
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  if (!isServiceRoleConfigured()) {
    throw new Error(
      "[Supabase] Service role key not configured. " +
        "Set SUPABASE_SERVICE_ROLE_KEY (via wrangler secret or .env.local). " +
        "Route Handlers will return seed data until this is set."
    );
  }

  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

/**
 * Returns true when a real Supabase connection is available.
 * Pages use this to branch between live data and seed data.
 */
export { isSupabaseConfigured, isServiceRoleConfigured };
