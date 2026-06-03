import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number of tokens with comma separators.
 * For numbers >= 1,000,000,000 renders as "XX.XX bil" (2 dp).
 * The exact full number is available via formatTokensExact() for hover tooltips.
 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} bil`;
  return n.toLocaleString("en-US");
}

/** Full comma-separated number, always. Use as title= for hover tooltip on large numbers. */
export function formatTokensExact(n: number): string {
  return n.toLocaleString("en-US");
}

/** Compact token formatter for chart axes: 1.2M, 350K, etc. */
export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Compact cost formatter for chart axes: $1.2K, $350, etc. */
export function formatCostCompact(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format cost in USD.
 * Pass null when cost_usd is null (pricing_snapshots not yet populated).
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ISO date string → "May 28" */
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
