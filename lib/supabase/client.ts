/**
 * Stubbed Supabase client.
 *
 * Status: NOT CONFIGURED -- env vars pending Supabase provisioning.
 *
 * Once NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set,
 * this module returns a real typed Supabase client. Until then, read calls
 * throw a clear "not configured" error rather than silently returning null.
 *
 * Swap-in target for v0.2: replace the stub branch with:
 *   import { createBrowserClient } from "@supabase/ssr";
 *   return createBrowserClient(url, key);
 *
 * See: https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// Singleton for browser-side client
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
 * Returns true when a real Supabase connection is available.
 * Pages use this to branch between live data and seed data.
 */
export { isSupabaseConfigured };
