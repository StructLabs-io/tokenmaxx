"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PREFS, loadPrefs } from "@/lib/preferences";
import { RefreshCw } from "lucide-react";

/**
 * Polls server data on the interval defined in user preferences.
 * Re-uses Next.js's router.refresh() which re-runs RSC data fetches.
 * Persists user prefs across pages; Settings page mutates and dispatches
 * "tokenmaxx:prefs-changed" so this component picks up changes live.
 */
export function AutoRefresh() {
  const router = useRouter();
  const [sec, setSec] = useState<number>(DEFAULT_PREFS.autoRefreshSec);
  const [tick, setTick] = useState(0);

  useEffect(() => { setSec(loadPrefs().autoRefreshSec); }, []);

  useEffect(() => {
    function onPrefs(e: any) { setSec(e.detail?.autoRefreshSec ?? DEFAULT_PREFS.autoRefreshSec); }
    window.addEventListener("tokenmaxx:prefs-changed", onPrefs as any);
    return () => window.removeEventListener("tokenmaxx:prefs-changed", onPrefs as any);
  }, []);

  useEffect(() => {
    if (!sec || sec < 5) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      router.refresh();
    }, sec * 1000);
    return () => clearInterval(id);
  }, [sec, router]);

  if (!sec) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title={`Auto-refreshing every ${sec}s`}>
      <RefreshCw className={`h-3 w-3 ${tick % 2 === 0 ? "opacity-60" : ""}`} />
      {sec}s
    </span>
  );
}
