/**
 * Supabase database type definitions.
 *
 * Status: Placeholder -- schema not yet migrated.
 * Replace this with the generated output from:
 *   npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts
 *
 * These types mirror the planned schema from 03-data-model.md.
 * They will be superseded by the generated types once Supabase is provisioned.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      usage_events: {
        Row: {
          id: string;
          created_at: string;
          user_id: string;
          workspace_id: string;
          project_id: string | null;
          model: string;
          provider: string;
          tool: string;
          surface: string;
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
          cost_usd: number;
          capture_method: string;
          aggregation_grain: "event" | "session" | "daily";
          session_start: string | null;
          session_end: string | null;
          metadata: Json | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["usage_events"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["usage_events"]["Insert"]
        >;
      };
      projects: {
        Row: {
          id: string;
          created_at: string;
          workspace_id: string;
          name: string;
          slug: string;
          toggl_project_id: number | null;
          color: string | null;
          archived: boolean;
        };
        Insert: Omit<
          Database["public"]["Tables"]["projects"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
      };
      users: {
        Row: {
          id: string;
          created_at: string;
          workspace_id: string;
          display_name: string;
          account_type: "human" | "service";
          capture_name: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["users"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      quota_windows: {
        Row: {
          id: string;
          provider: string;
          window_type: "rolling_5h" | "weekly" | "monthly";
          label: string;
          cap_tokens: number | null;
          notes: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["quota_windows"]["Row"], "id">;
        Update: Partial<Database["public"]["Tables"]["quota_windows"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      account_type: "human" | "service";
      aggregation_grain: "event" | "session" | "daily";
    };
  };
}

// Convenience row types
export type UsageEvent = Database["public"]["Tables"]["usage_events"]["Row"];
export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type QuotaWindow = Database["public"]["Tables"]["quota_windows"]["Row"];
