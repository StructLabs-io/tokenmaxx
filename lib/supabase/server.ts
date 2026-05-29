import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * SSR-aware Supabase client using the anon key + cookie-based sessions.
 *
 * Use this in RSC, Route Handlers, and Server Actions where you need
 * auth context (getUser, session checks). It reads/writes the Supabase
 * session cookies so the session stays fresh.
 *
 * Do NOT use this for data reads that must bypass RLS — use
 * getSupabaseServerClient() from lib/supabase/client.ts (service role key).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll is called from RSC (read-only cookie store). Safe to ignore --
            // the middleware handles session refresh via response cookies.
          }
        },
      },
    }
  );
}
