import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QuotaWindow } from "@/lib/supabase/types";

interface WindowCardProps {
  window: QuotaWindow;
  /**
   * Fill percentage as 0..1, or null when cap data is not yet available.
   * Null renders an "unknown" state (dimmed bar).
   */
  fillPct: number | null;
}

function fillColor(pct: number): string {
  if (pct >= 0.8) return "bg-red-500";
  if (pct >= 0.6) return "bg-amber-400";
  return "bg-indigo-500";
}

function deriveProvider(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "Claude";
  if (lower.includes("codex") || lower.includes("openai")) return "OpenAI";
  if (lower.includes("gemini") || lower.includes("google")) return "Google";
  return label.split("—")[0].trim();
}

export function WindowCard({ window: qw, fillPct }: WindowCardProps) {
  const isUnknown = fillPct == null;
  const pct = isUnknown ? 0 : fillPct;
  const pctDisplay = Math.round(pct * 100);
  const provider = deriveProvider(qw.window_label);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{qw.window_label}</CardTitle>
          <Badge variant="outline" className="text-xs">
            {provider}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 space-y-2">
        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          {isUnknown ? (
            <div className="h-full rounded-full bg-muted-foreground/30 w-full" />
          ) : (
            <div
              className={cn("h-full rounded-full transition-all", fillColor(pct))}
              style={{ width: `${pctDisplay}%` }}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {isUnknown ? (
            <span className="text-muted-foreground/60">Usage: unknown</span>
          ) : (
            <span>{pctDisplay}% used</span>
          )}
          <span className="text-amber-500 dark:text-amber-400">
            Cap: unknown
          </span>
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
