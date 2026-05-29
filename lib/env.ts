import { z } from "zod";

/**
 * Typed environment access.
 *
 * Usage:
 *   import { env } from "@/lib/env";
 *   const url = env.NEXT_PUBLIC_SUPABASE_URL;
 *
 * Throws at module load time with a clear message if required vars are missing.
 * NEXT_PUBLIC_* vars are safe in browser bundles -- they're baked in at build time.
 * Non-public vars should only be accessed in server components / route handlers.
 */

const envSchema = z.object({
  /** Supabase project URL -- safe for browser (public) */
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .optional()
    .default("https://placeholder.supabase.co"),

  /** Supabase anon key -- safe for browser (public, RLS protects data) */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .optional()
    .default("placeholder-anon-key"),

  /** Next.js app base URL */
  NEXTAUTH_URL: z.string().url().optional(),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  return result.data;
}

export const env = parseEnv();

/** Returns true when both Supabase vars are real (not placeholder) */
export function isSupabaseConfigured(): boolean {
  return (
    env.NEXT_PUBLIC_SUPABASE_URL !== "https://placeholder.supabase.co" &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== "placeholder-anon-key"
  );
}
