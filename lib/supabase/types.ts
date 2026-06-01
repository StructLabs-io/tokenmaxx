/**
 * Supabase database type definitions.
 *
 * Hand-authored to match the prod schema (03-data-model.md v0.2).
 * Replace with generated types once Supabase CLI is set up:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_REF > lib/supabase/types.ts
 *
 * Key schema facts:
 *   - cost_usd is null on all rows until pricing_snapshots is populated
 *   - total_tokens is a generated stored column (input + output + cache_creation + cache_read)
 *   - capture_method is a four-part dot-separated string (provider.tool.surface.context)
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
          id: number;
          workspace_id: string;
          user_id: string;
          subscription_id: string | null;
          project_id: string | null;
          captured_at: string;
          date_utc: string;
          date_local: string;
          provider: string;
          model: string;
          capture_method: string;
          aggregation_grain: "turn" | "session" | "daily" | "batch";
          session_id: string | null;
          source_path: string | null;
          input_tokens: number;
          output_tokens: number;
          cache_creation_tokens: number;
          cache_read_tokens: number;
          total_tokens: number;
          cost_usd: number | null;
          pricing_snapshot_id: number | null;
          token_share_pct: number | null;
          project_hint: string | null;
          runtime_ms: number | null;
          notes: string | null;
          ingested_at: string;
          raw: Json | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["usage_events"]["Row"],
          "id" | "total_tokens" | "ingested_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["usage_events"]["Insert"]
        >;
      };
      projects: {
        Row: {
          id: string;
          workspace_id: string;
          slug: string;
          display_name: string;
          client: string | null;
          toggl_project_id: number | null;
          billable: boolean;
          active: boolean;
          notes: string | null;
          created_at: string;
          deleted_at: string | null;
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
          auth_user_id: string | null;
          slug: string;
          display_name: string;
          account_type: "human" | "service";
          email: string | null;
          default_timezone: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["users"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      workspaces: {
        Row: {
          id: string;
          slug: string;
          display_name: string;
          timezone: string;
          public_read: boolean;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["workspaces"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["workspaces"]["Insert"]>;
      };
      subscriptions: {
        Row: {
          id: string;
          workspace_id: string;
          provider: string;
          plan_name: string;
          monthly_cost_usd: number | null;
          active: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["subscriptions"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
      };
      quota_windows: {
        Row: {
          id: number;
          subscription_id: string;
          window_label: string;
          window_type: "rolling_hours" | "calendar_week" | "calendar_month";
          window_hours: number | null;
          reset_anchor: string | null;
          active: boolean;
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["quota_windows"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["quota_windows"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      account_type: "human" | "service";
      aggregation_grain: "turn" | "session" | "daily" | "batch";
    };
  };
}

// Convenience row types
export type UsageEvent = Database["public"]["Tables"]["usage_events"]["Row"];
export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type QuotaWindow = Database["public"]["Tables"]["quota_windows"]["Row"];

// ---- API response shapes (shared between Route Handlers and client pages) ----

/** Daily aggregate row for the home chart */
export interface DailyTotal {
  date: string;
  tokens: number;
  cost: number | null;
}

/** Project with rolled-up token/cost totals */
export interface ProjectTotals {
  id: string;
  slug: string;
  display_name: string;
  client: string | null;
  totalTokens: number;
  totalCost: number | null;
}

/** Summary stats for the home page */
export interface DashboardStats {
  totalEvents: number;
  periodDays: number;
  totalTokens: number;
  totalCost: number | null;
  dailyTotals: DailyTotal[];
  topProjects: ProjectTotals[];
}

/** Quota window with live token usage */
export interface QuotaWindowWithUsage {
  id: number;
  subscription_id: string;
  window_label: string;
  window_type: "rolling_hours" | "calendar_week" | "calendar_month";
  window_hours: number | null;
  tokens_in_window: number;
  notes: string | null;
}

/** Subscription with rolled-up 30-day usage and quota window data */
export interface SubscriptionSummary {
  id: string;
  provider: string;
  plan_name: string;
  monthly_cost_usd: number | null;
  tokens_30d: number;
  cost_30d: number | null;
  windows: QuotaWindowWithUsage[];
}

/** Model breakdown row for /models page */
export interface ModelBreakdownRow {
  provider: string;
  model: string;
  event_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
}

/** Paginated events response */
export interface EventsPage {
  events: UsageEventRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Lightweight event row for list views */
export interface UsageEventRow {
  id: number;
  captured_at: string;
  date_utc: string;
  user_id: string;
  user_display_name: string | null;
  project_id: string | null;
  project_display_name: string | null;
  model: string;
  provider: string;
  capture_method: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  session_id: string | null;
}

/** User with rolled-up 30-day token/cost totals — for /users page */
export interface UserSummaryRow {
  id: string;
  slug: string;
  display_name: string;
  account_type: "human" | "service";
  email: string | null;
  default_timezone: string;
  total_tokens: number;
  cost_usd: number | null;
}

/** Input shape for creating a new project */
export interface CreateProjectInput {
  display_name: string;
  slug: string;
  client?: string;
  billable: boolean;
}

// ---- Wrap (2026 YTD) — /api/wrap + /wrap page ----

export interface ProviderBreakdown {
  provider: string;
  tokens: number;
  cost: number | null;
  pct: number;
}

export interface WrapProject {
  id: string;
  slug: string;
  display_name: string;
  client: string | null;
  tokens: number;
  cost: number | null;
}

export interface MonthlyTotal {
  month: string; // "2026-01" … "2026-12"
  label: string; // "Jan", "Feb", …
  tokens: number;
  cost: number | null;
}

export interface WrapStats {
  year: number;
  totalTokens: number;
  totalCost: number | null;
  totalEvents: number;
  topModel: string | null;
  topModelTokens: number;
  topMonth: string | null;
  topMonthTokens: number;
  peakDay: string | null;
  peakDayTokens: number;
  providerBreakdown: ProviderBreakdown[];
  topProjects: WrapProject[];
  monthlyTotals: MonthlyTotal[];
}

// ---- Reconcile — /api/reconcile + /reconcile page ----

export interface UnattributedGroup {
  date_utc: string;
  model: string;
  capture_method: string;
  event_count: number;
  total_tokens: number;
  total_cost: number | null;
}
