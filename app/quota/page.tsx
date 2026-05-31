/**
 * /quota — Quota headroom across all subscription windows
 *
 * Server component: fetches data via getQuotaWindowDetails().
 * Shows all active quota windows with live token usage, time-to-reset,
 * and cap placeholders (quota scraping not yet implemented).
 */

import { getQuotaWindowDetails } from "@/lib/data";
import { formatTokens } from "@/lib/utils";
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

export default async function QuotaPage() {
  const { windows, usingSeedData } = await getQuotaWindowDetails();

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

      {/* No-cap notice */}
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
        <span className="font-medium">Quota caps not set</span> — run quota scraping to populate{" "}
        <code className="text-xs bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">
          quota_tokens
        </code>
        . Progress bars will activate once caps are available.
      </div>

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
                    />

                    {/* Supplementary info below the card */}
                    <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                      <span>
                        Tokens used:{" "}
                        <span className="font-medium text-foreground tabular-nums">
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
                    <span className="tabular-nums font-medium">
                      {formatTokens(w.tokens_in_window)}
                    </span>
                    <span className="ml-2 text-xs text-amber-500 dark:text-amber-400">
                      / cap unknown
                    </span>
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
