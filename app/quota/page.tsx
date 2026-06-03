/**
 * /quota — Quota headroom across all subscription windows
 *
 * Server component: fetches data via getQuotaWindowDetails().
 * Shows all active quota windows with live token usage, time-to-reset,
 * and cap placeholders (quota scraping not yet implemented).
 */

import { getQuotaWindowDetails } from "@/lib/data";
import { formatTokens, formatTokensExact } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WindowCard } from "@/components/quota/window-card";
import type { QuotaWindow } from "@/lib/supabase/types";
import type { QuotaWindowDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

function formatTimeRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function windowTypeLabel(detail: QuotaWindowDetail): string {
  if (detail.window_type === "rolling_hours" && detail.window_hours != null) {
    return `${detail.window_hours}h rolling`;
  }
  if (detail.window_type === "calendar_week") return "Calendar week (Mon–Sun)";
  if (detail.window_type === "calendar_month") return "Calendar month";
  return detail.window_type;
}

function providerLabel(provider: string): string {
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai-codex") return "OpenAI Codex";
  return provider;
}

/**
 * Shape the QuotaWindowDetail into the QuotaWindow row type that WindowCard expects.
 * WindowCard only reads: id, subscription_id, window_label, window_type,
 * window_hours, reset_anchor, active, notes, created_at.
 */
function toWindowCardProp(detail: QuotaWindowDetail): QuotaWindow {
  return {
    id: detail.id,
    subscription_id: detail.subscription_id,
    window_label: detail.window_label,
    window_type: detail.window_type,
    window_hours: detail.window_hours,
    reset_anchor: null,
    active: true,
    notes: detail.notes,
    created_at: new Date(0).toISOString(),
  };
}

async function getInferredCaps(): Promise<Map<number, { p25: number; p50: number; p75: number; n: number; confidence: string }>> {
  try {
    const { getSupabaseServerClient, isServiceRoleConfigured } = await import("@/lib/supabase/client");
    if (!isServiceRoleConfigured()) return new Map();
    const sb = getSupabaseServerClient();
    const { data, error } = await (sb as any).rpc("fn_quota_caps_inferred");
    if (error || !Array.isArray(data)) return new Map();
    const m = new Map<number, any>();
    for (const r of data) {
      m.set(r.window_id, {
        p25: Number(r.cap_p25) || 0,
        p50: Number(r.cap_p50) || 0,
        p75: Number(r.cap_p75) || 0,
        n: r.n_samples ?? 0,
        confidence: r.confidence ?? "low",
      });
    }
    return m;
  } catch { return new Map(); }
}

export default async function QuotaPage() {
  const [{ windows, usingSeedData }, caps] = await Promise.all([
    getQuotaWindowDetails(),
    getInferredCaps(),
  ]);

  // Group by subscription (provider + plan_name)
  type Group = { provider: string; plan_name: string; windows: QuotaWindowDetail[] };
  const groups = new Map<string, Group>();
  for (const w of windows) {
    const key = w.subscription_id;
    if (!groups.has(key)) {
      groups.set(key, { provider: w.provider, plan_name: w.plan_name, windows: [] });
    }
    groups.get(key)!.windows.push(w);
  }

  const totalWindowCount = windows.length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quota</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Token headroom across all active quota windows
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usingSeedData && (
            <Badge variant="secondary" className="text-xs">
              Seed data
            </Badge>
          )}
          {totalWindowCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {totalWindowCount} window{totalWindowCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      {/* Cap inference notice */}
      {caps.size > 0 ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300">
          <span className="font-medium">Estimated caps shown</span> — best-effort inference from{" "}
          <code className="text-xs bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5 rounded">
            tokens_observed / (percent_used / 100)
          </code>{" "}
          across recent quota observations (filtered to ≥15% usage, single dominant model). Confidence label reflects sample size + spread. Not official from Anthropic/OpenAI.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
          <span className="font-medium">No cap inference yet</span> — needs more high-percent observations to compute. Use your subscription heavily and the estimate will populate.
        </div>
      )}

      {windows.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-muted-foreground text-sm">
            No active quota windows found. Add rows to the{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">quota_windows</code> table to
            get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(groups.values()).map((group) => (
            <div key={group.provider + group.plan_name} className="space-y-3">
              {/* Subscription group header */}
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{group.plan_name}</h2>
                <Badge variant="outline" className="text-xs">
                  {providerLabel(group.provider)}
                </Badge>
              </div>

              {group.provider === "openai-codex" && (
                <p className="text-xs text-muted-foreground rounded border border-border bg-muted/40 px-3 py-1.5">
                  Quota % is polled every 30 min via session cookie.{" "}
                  <span className="text-foreground/70">
                    If bars show stale, refresh <code className="font-mono text-[11px]">CHATGPT_SESSION_TOKEN_0/1</code> in <code className="font-mono text-[11px]">shared/.env</code> and crontab.
                  </span>
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {group.windows.map((detail) => (
                  <div key={detail.id} className="space-y-2">
                    {/* WindowCard handles the progress bar / cap display */}
                    <WindowCard
                      window={toWindowCardProp(detail)}
                      fillPct={detail.fillPct ?? null}
                      estimatedCap={
                        detail.fillPct != null && detail.fillPct > 0 && detail.tokens_in_window > 0
                          ? Math.round(detail.tokens_in_window / detail.fillPct)
                          : null
                      }
                    />

                    {/* Inferred cap row */}
                    {caps.get(detail.id) && (
                      <div className="px-1 text-xs">
                        <div className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-2 py-1">
                          <span className="text-muted-foreground">
                            Estimated cap{" "}
                            <span
                              className={
                                caps.get(detail.id)!.confidence === "high"
                                  ? "text-emerald-500"
                                  : caps.get(detail.id)!.confidence === "medium"
                                  ? "text-amber-500"
                                  : "text-muted-foreground/60"
                              }
                              title={`Confidence: ${caps.get(detail.id)!.confidence} (n=${caps.get(detail.id)!.n} samples)`}
                            >
                              · {caps.get(detail.id)!.confidence}
                            </span>
                          </span>
                          <span className="tabular-nums text-foreground">
                            ~<span title={formatTokensExact(caps.get(detail.id)!.p50)}>{formatTokens(caps.get(detail.id)!.p50)}</span>{" "}
                            <span className="text-muted-foreground">
                              (<span title={formatTokensExact(caps.get(detail.id)!.p25)}>{formatTokens(caps.get(detail.id)!.p25)}</span>–<span title={formatTokensExact(caps.get(detail.id)!.p75)}>{formatTokens(caps.get(detail.id)!.p75)}</span>)
                            </span>
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Supplementary info below the card */}
                    <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                      <span>
                        Tokens used:{" "}
                        <span className="font-medium text-foreground tabular-nums" title={formatTokensExact(detail.tokens_in_window)}>
                          {formatTokens(detail.tokens_in_window)}
                        </span>
                      </span>
                      <span>
                        {detail.window_type === "rolling_hours" &&
                        detail.ms_until_reset != null ? (
                          <>
                            Resets in up to{" "}
                            <span className="font-medium text-foreground">
                              {formatTimeRemaining(detail.ms_until_reset)}
                            </span>
                          </>
                        ) : (
                          windowTypeLabel(detail)
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary table */}
      {windows.length > 0 && (
        <Card>
          <CardHeader className="px-5 pb-2">
            <CardTitle className="text-sm font-medium">All windows</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="space-y-1">
              {windows.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0 text-sm"
                >
                  <div>
                    <span className="font-medium">{w.window_label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {windowTypeLabel(w)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="tabular-nums font-medium" title={formatTokensExact(w.tokens_in_window)}>
                      {formatTokens(w.tokens_in_window)}
                    </span>
                    {w.fillPct != null && w.fillPct > 0 && w.tokens_in_window > 0 ? (
                      <span
                        className="ml-2 text-xs text-muted-foreground"
                        title={`Estimated cap: ${formatTokensExact(Math.round(w.tokens_in_window / w.fillPct))}`}
                      >
                        / ~{formatTokens(Math.round(w.tokens_in_window / w.fillPct))}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-amber-500 dark:text-amber-400">
                        / cap unknown
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
