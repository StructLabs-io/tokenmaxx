import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QuotaWindow } from "@/lib/supabase/types";

interface WindowCardProps {
  window: QuotaWindow;
  /** 0..1 fill percentage (seed or computed from events) */
  fillPct: number;
}

function fillColor(pct: number): string {
  if (pct >= 0.8) return "bg-red-500";
  if (pct >= 0.6) return "bg-amber-400";
  return "bg-indigo-500";
}

function providerLabel(provider: string): string {
  if (provider === "anthropic") return "Claude";
  if (provider === "openai") return "OpenAI";
  return provider;
}

export function WindowCard({ window: qw, fillPct }: WindowCardProps) {
  const pctDisplay = Math.round(fillPct * 100);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{qw.label}</CardTitle>
          <Badge variant="outline" className="text-xs">
            {providerLabel(qw.provider)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 space-y-2">
        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", fillColor(fillPct))}
            style={{ width: `${pctDisplay}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{pctDisplay}% used</span>
          {qw.cap_tokens == null ? (
            <span className="text-amber-500 dark:text-amber-400">
              Cap: unknown
            </span>
          ) : (
            <span>Cap: {qw.cap_tokens.toLocaleString()} tok</span>
          )}
        </div>

        {qw.notes && (
          <p className="text-xs text-muted-foreground leading-tight">
            {qw.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
