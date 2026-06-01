"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Provider = "anthropic" | "openai-codex";

type Window = {
  id: number;
  subscription_id: string;
  window_label: string;
  window_type: string;
  window_hours: number | null;
  notes: string | null;
  provider: Provider | string;
  fillPct: number | null;
  latest_observed_at: string | null;
};

interface Props {
  windows: Window[];
}

const TOGGLE_STORAGE_KEY = "tokenmaxx:quota:display-mode";

function fillColor(pct: number): string {
  if (pct >= 0.8) return "bg-red-500";
  if (pct >= 0.6) return "bg-amber-400";
  return "bg-indigo-500";
}

function MiniWindow({ w, mode }: { w: Window; mode: "used" | "remaining" }) {
  const unknown = w.fillPct == null;
  const usedPct = unknown ? 0 : w.fillPct!;
  const remainingPct = unknown ? 0 : 1 - w.fillPct!;
  const shownPct = mode === "used" ? usedPct : remainingPct;
  const label = mode === "used" ? "used" : "remaining";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{w.window_label}</span>
        {unknown ? (
          <span className="text-muted-foreground/60">unknown</span>
        ) : (
          <span className="tabular-nums text-foreground">
            {Math.round(shownPct * 100)}% {label}
          </span>
        )}
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        {unknown ? (
          <div className="h-full rounded-full bg-muted-foreground/30 w-full" />
        ) : (
          <div
            className={cn("h-full rounded-full transition-all", fillColor(usedPct))}
            style={{ width: `${Math.round(shownPct * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function QuotaSection({ windows }: Props) {
  const [mode, setMode] = useState<"used" | "remaining">("used");

  // Persist toggle across sessions
  useEffect(() => {
    const stored = localStorage.getItem(TOGGLE_STORAGE_KEY);
    if (stored === "used" || stored === "remaining") setMode(stored);
  }, []);
  useEffect(() => {
    localStorage.setItem(TOGGLE_STORAGE_KEY, mode);
  }, [mode]);

  const claude = windows.filter((w) => w.provider === "anthropic");
  const codex = windows.filter((w) => w.provider === "openai-codex");

  // Stale check (same logic as before)
  const STALE_MS = 90 * 60 * 1000;
  const codexStale =
    codex.length > 0 &&
    codex.some(
      (w) =>
        w.latest_observed_at == null ||
        Date.now() - new Date(w.latest_observed_at).getTime() > STALE_MS,
    );

  if (windows.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-sm font-medium">Quota windows</h2>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs bg-muted/40">
          <button
            type="button"
            onClick={() => setMode("used")}
            className={cn(
              "px-2.5 py-0.5 rounded transition-colors",
              mode === "used" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Used
          </button>
          <button
            type="button"
            onClick={() => setMode("remaining")}
            className={cn(
              "px-2.5 py-0.5 rounded transition-colors",
              mode === "remaining" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Remaining
          </button>
        </div>
      </div>

      {codexStale && (
        <p className="text-xs rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300 px-3 py-1.5">
          ⚠ Codex quota data is stale. Tokens will auto-refresh on the next quota-codex cron (every 30 min).
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {claude.length > 0 && (
          <Card>
            <CardHeader className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#cc785c] text-white text-sm font-bold">C</span>
                <CardTitle className="text-sm font-semibold">Anthropic Claude</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-3">
              {claude.map((w) => (
                <MiniWindow key={w.id} w={w} mode={mode} />
              ))}
            </CardContent>
          </Card>
        )}
        {codex.length > 0 && (
          <Card>
            <CardHeader className="px-5 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-black text-white text-sm font-bold">O</span>
                <CardTitle className="text-sm font-semibold">OpenAI Codex</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-3">
              {codex.map((w) => (
                <MiniWindow key={w.id} w={w} mode={mode} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
