/**
 * /subscriptions — Subscription plan utilisation
 *
 * Server component: fetches data via getSubscriptionsSummary().
 * Shows per-plan 30-day usage, quota windows, and cost efficiency.
 */

import { getSubscriptionsSummary } from "@/lib/data";
import { formatTokens, formatCost } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SubscriptionSummary } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function providerBadge(provider: string) {
  const label = provider === "anthropic" ? "Anthropic" : provider === "openai-codex" ? "OpenAI Codex" : provider;
  const className =
    provider === "anthropic"
      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
      : provider === "openai-codex"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function SubscriptionCard({ sub }: { sub: SubscriptionSummary }) {
  const costEfficiencyText =
    sub.monthly_cost_usd != null && sub.cost_30d != null
      ? (() => {
          const ratio = sub.cost_30d / sub.monthly_cost_usd;
          if (ratio >= 1) {
            const multiple = ratio.toFixed(1);
            return `Equivalent API cost: ${formatCost(sub.cost_30d)} — you're getting ${multiple}× the value of the ${formatCost(sub.monthly_cost_usd)}/mo flat plan.`;
          }
          const pct = Math.round(ratio * 100);
          return `Equivalent API cost: ${formatCost(sub.cost_30d)} (${pct}% of the ${formatCost(sub.monthly_cost_usd)}/mo flat plan). Room to use more before the plan pays off vs API pricing.`;
        })()
      : sub.monthly_cost_usd != null
      ? `Subscription: ${formatCost(sub.monthly_cost_usd)}/mo — usage cost not yet calculated.`
      : null;

  return (
    <Card>
      <CardHeader className="px-5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold">{sub.plan_name}</CardTitle>
          {providerBadge(sub.provider)}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {sub.monthly_cost_usd != null
            ? `${formatCost(sub.monthly_cost_usd)}/mo`
            : "Monthly cost unknown"}
        </p>
      </CardHeader>

      <CardContent className="px-5 space-y-4">
        {/* 30-day summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Tokens (30d)</p>
            <p className="text-lg font-semibold tabular-nums mt-0.5">
              {formatTokens(sub.tokens_30d)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Cost (30d)</p>
            <p className="text-lg font-semibold tabular-nums mt-0.5">
              {sub.cost_30d != null ? formatCost(sub.cost_30d) : "—"}
            </p>
          </div>
        </div>

        {/* Quota windows */}
        {sub.windows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Quota windows
            </p>
            {sub.windows.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div className="space-y-0.5">
                  <p className="font-medium leading-none">{w.window_label}</p>
                  <p className="text-xs text-muted-foreground">
                    {w.window_type === "rolling_hours" && w.window_hours != null
                      ? `${w.window_hours}h rolling`
                      : w.window_type === "calendar_week"
                      ? "Calendar week"
                      : "Calendar month"}
                  </p>
                </div>
                <div className="text-right space-y-0.5">
                  <p className="font-medium tabular-nums">{formatTokens(w.tokens_in_window)}</p>
                  <p className="text-xs text-muted-foreground">
                    Cap:{" "}
                    <span className="text-amber-500 dark:text-amber-400">unknown</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Cost efficiency */}
        {costEfficiencyText && (
          <div className="rounded-md bg-muted/40 border border-border px-3 py-2.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Cost efficiency: </span>
            {costEfficiencyText}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function SubscriptionsPage() {
  const { subscriptions, usingSeedData } = await getSubscriptionsSummary();

  const totalMonthlyCost = subscriptions.reduce(
    (s, sub) => (sub.monthly_cost_usd != null ? s + sub.monthly_cost_usd : s),
    0
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Plan utilisation, quota windows, and cost efficiency
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usingSeedData && (
            <Badge variant="secondary" className="text-xs">
              Seed data
            </Badge>
          )}
          {subscriptions.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {subscriptions.length} plan{subscriptions.length !== 1 ? "s" : ""} ·{" "}
              {formatCost(totalMonthlyCost)}/mo
            </Badge>
          )}
        </div>
      </div>

      {subscriptions.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-10 text-center text-muted-foreground text-sm">
            No active subscriptions found. Add rows to the{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">subscriptions</code> table to
            get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {subscriptions.map((sub) => (
            <SubscriptionCard key={sub.id} sub={sub} />
          ))}
        </div>
      )}
    </div>
  );
}
