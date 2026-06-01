/**
 * Client-side preferences persisted in localStorage. Required by:
 *   §2.5 chart granularity availability
 *   §2.7 chart default settings
 *   §2.9 auto-refresh interval
 *   §5.1 user timezone for date display
 */

export type GranularityId = "1m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" | "1d" | "1w" | "1mo";

export interface Preferences {
  timezone: string;
  autoRefreshSec: number;        // 0 = off
  enabledGranularities: GranularityId[];
  defaultChartTimeframe: string; // "1D" | "3D" | "7D" | "14D" | "30D"
  defaultDimension: "model" | "project" | "user" | "provider" | "source";
}

export const DEFAULT_PREFS: Preferences = {
  timezone: "Asia/Kuala_Lumpur",
  autoRefreshSec: 60,
  enabledGranularities: ["1h", "2h", "6h", "12h", "1d", "1w"],
  defaultChartTimeframe: "14D",
  defaultDimension: "model",
};

const STORAGE_KEY = "tokenmaxx:preferences";

export function loadPrefs(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Partial<Preferences>) {
  if (typeof window === "undefined") return;
  const merged = { ...loadPrefs(), ...p };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent("tokenmaxx:prefs-changed", { detail: merged }));
}

export const ALL_GRANULARITIES: { id: GranularityId; label: string }[] = [
  { id: "1m", label: "1 minute" },
  { id: "5m", label: "5 minutes" },
  { id: "15m", label: "15 minutes" },
  { id: "30m", label: "30 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "2h", label: "2 hours" },
  { id: "4h", label: "4 hours" },
  { id: "6h", label: "6 hours" },
  { id: "8h", label: "8 hours" },
  { id: "12h", label: "12 hours" },
  { id: "1d", label: "Daily" },
  { id: "1w", label: "Weekly" },
  { id: "1mo", label: "Monthly" },
];
