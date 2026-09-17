export type PaceObservation = {
  observed_at: string;
  percent_used: number;
};

export type PaceWindowType = "rolling_hours" | "calendar_week" | "calendar_month" | "account_period" | string;

export type PaceTone =
  | "super_critical"
  | "critical"
  | "warning"
  | "over_pace"
  | "on_track"
  | "under_using"
  | "idle"
  | "unknown";

export type PaceUnit = "day" | "hour";

export type PaceLookback = {
  id: string;
  label: string;
  burnPerUnit: number | null;
  runway: number | null;
  unit: PaceUnit;
};

export type PaceResult = {
  remainingPct: number | null;
  nextResetAt: string | null;
  timeToReset: number | null;
  unit: PaceUnit;
  lookbacks: PaceLookback[];
  headline: PaceLookback | null;
  tone: PaceTone;
};

const RESET_DROP_POINTS = 20;
const IDLE_BURN = 0.05;
const EMPTY_REMAINING = 0.5;
const ON_TRACK_RELATIVE = 0.2;

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nested(raw: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function resolveNextResetAt(
  raw: Record<string, unknown> | null | undefined,
  windowType?: string,
): string | null {
  const record = asRecord(raw);
  const direct = toIsoTimestamp(record.nextResetAt)
    ?? toIsoTimestamp(record.nextResetTimestampUtc)
    ?? toIsoTimestamp(record.resets_at)
    ?? toIsoTimestamp(record.resetAt);
  if (direct) return direct;

  const primary = toIsoTimestamp(nested(record, ["rate_limit", "primary_window", "reset_at"]));
  const secondary = toIsoTimestamp(nested(record, ["rate_limit", "secondary_window", "reset_at"]));
  if (windowType === "rolling_hours" && primary) return primary;
  if ((windowType === "calendar_week" || windowType === "calendar_month") && secondary) return secondary;
  if (primary && !secondary) return primary;
  if (secondary && !primary) return secondary;

  return toIsoTimestamp(record.billingCycleEnd);
}

export function resolvePeriodStart(raw: Record<string, unknown> | null | undefined): string | null {
  const record = asRecord(raw);
  return toIsoTimestamp(record.currentPeriodStart)
    ?? toIsoTimestamp(record.billingCycleStart)
    ?? toIsoTimestamp(record.period_start);
}

export function resolveCostFromRaw(raw: Record<string, unknown> | null | undefined): {
  costUsedUsd: number | null;
  costCapUsd: number | null;
} {
  const record = asRecord(raw);
  const usedCents = typeof record.planUsedCents === "number" ? record.planUsedCents : null;
  const capCents = typeof record.planLimitCents === "number" ? record.planLimitCents : null;
  return {
    costUsedUsd: usedCents != null && Number.isFinite(usedCents) ? usedCents / 100 : null,
    costCapUsd: capCents != null && Number.isFinite(capCents) && capCents > 0 ? capCents / 100 : null,
  };
}

function sortObservations(observations: PaceObservation[]): PaceObservation[] {
  return observations
    .filter((row) => Number.isFinite(row.percent_used) && !Number.isNaN(Date.parse(row.observed_at)))
    .slice()
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
}

function isResetDrop(previous: number, next: number): boolean {
  return previous - next >= RESET_DROP_POINTS
    || (previous >= 15 && next <= previous * 0.4 && previous - next >= 10);
}

function lastResetIndex(rows: PaceObservation[]): number {
  for (let index = rows.length - 1; index >= 1; index -= 1) {
    if (isResetDrop(rows[index - 1].percent_used, rows[index].percent_used)) return index;
  }
  return 0;
}

function elapsedUnits(fromMs: number, toMs: number, unit: PaceUnit): number {
  const hours = (toMs - fromMs) / 3_600_000;
  return unit === "hour" ? hours : hours / 24;
}

function sampleAtOrAfter(rows: PaceObservation[], startMs: number): PaceObservation | null {
  for (const row of rows) {
    if (Date.parse(row.observed_at) >= startMs) return row;
  }
  return rows[0] ?? null;
}

function lookback(args: {
  id: string;
  label: string;
  rows: PaceObservation[];
  latest: PaceObservation;
  remainingPct: number;
  durationMs: number;
  nowMs: number;
  unit: PaceUnit;
}): PaceLookback {
  const startMs = args.nowMs - args.durationMs;
  const first = sampleAtOrAfter(args.rows, startMs) ?? args.rows[0];
  if (!first) {
    return { id: args.id, label: args.label, burnPerUnit: null, runway: null, unit: args.unit };
  }
  const elapsed = elapsedUnits(Date.parse(first.observed_at), args.nowMs, args.unit);
  if (elapsed <= 0) {
    return { id: args.id, label: args.label, burnPerUnit: null, runway: null, unit: args.unit };
  }
  const delta = args.latest.percent_used - first.percent_used;
  const burn = delta > 0 ? delta / elapsed : 0;
  const idle = burn < IDLE_BURN;
  return {
    id: args.id,
    label: args.label,
    burnPerUnit: idle ? 0 : burn,
    runway: idle ? null : args.remainingPct / burn,
    unit: args.unit,
  };
}

function pickTone(args: {
  remainingPct: number | null;
  runway: number | null;
  timeToReset: number | null;
}): PaceTone {
  if (args.remainingPct == null) return "unknown";
  if (args.remainingPct <= EMPTY_REMAINING) return "super_critical";
  if (args.runway == null) return "idle";
  if (args.runway < 1) return "super_critical";
  const emptiesBeforeReset = args.timeToReset != null && args.runway < args.timeToReset;
  if (args.runway < 3 && emptiesBeforeReset) return "critical";
  if (args.runway < 7 && emptiesBeforeReset) return "warning";
  if (emptiesBeforeReset && args.runway >= 7) return "over_pace";
  if (args.timeToReset == null) {
    if (args.runway < 3) return "critical";
    if (args.runway < 7) return "warning";
    return "unknown";
  }
  const tolerance = Math.max(1, args.timeToReset * ON_TRACK_RELATIVE);
  if (Math.abs(args.runway - args.timeToReset) <= tolerance) return "on_track";
  if (args.runway > args.timeToReset) return "under_using";
  return "on_track";
}

export function paceRunway({
  observations,
  windowType,
  windowHours = null,
  nextResetAt = null,
  now = new Date(),
}: {
  observations: PaceObservation[];
  windowType: PaceWindowType;
  windowHours?: number | null;
  nextResetAt?: string | null;
  now?: Date;
}): PaceResult {
  const hourly = windowType === "rolling_hours";
  const unit: PaceUnit = hourly ? "hour" : "day";
  const sorted = sortObservations(observations);
  const resetAt = lastResetIndex(sorted);
  const rows = sorted.slice(resetAt);
  const latest = rows[rows.length - 1] ?? null;
  const remainingPct = latest == null ? null : Math.max(0, 100 - latest.percent_used);
  const nowMs = now.getTime();
  const resetMs = nextResetAt && !Number.isNaN(Date.parse(nextResetAt)) ? Date.parse(nextResetAt) : null;
  const timeToReset = resetMs == null ? null : Math.max(0, elapsedUnits(nowMs, resetMs, unit));

  const lookbacks = !latest
    ? []
    : hourly
      ? [
          lookback({
            id: "1h", label: "1H", rows, latest, remainingPct: remainingPct ?? 0,
            durationMs: 1 * 3_600_000, nowMs, unit,
          }),
          lookback({
            id: "5h", label: "5H", rows, latest, remainingPct: remainingPct ?? 0,
            durationMs: (windowHours ?? 5) * 3_600_000, nowMs, unit,
          }),
        ]
      : [
          lookback({
            id: "1d", label: "1D", rows, latest, remainingPct: remainingPct ?? 0,
            durationMs: 24 * 3_600_000, nowMs, unit,
          }),
          lookback({
            id: "7d", label: "7D", rows, latest, remainingPct: remainingPct ?? 0,
            durationMs: 7 * 24 * 3_600_000, nowMs, unit,
          }),
          lookback({
            id: "30d", label: "30D", rows, latest, remainingPct: remainingPct ?? 0,
            durationMs: 30 * 24 * 3_600_000, nowMs, unit,
          }),
        ];

  if (!latest) {
    return {
      remainingPct: null,
      nextResetAt,
      timeToReset,
      unit,
      lookbacks: [],
      headline: null,
      tone: "unknown",
    };
  }

  const headline = hourly
    ? lookbacks.find((row) => row.id === "5h") ?? lookbacks[lookbacks.length - 1]
    : lookbacks.find((row) => row.id === "7d") ?? lookbacks[1];

  return {
    remainingPct,
    nextResetAt,
    timeToReset,
    unit,
    lookbacks,
    headline,
    tone: pickTone({ remainingPct, runway: headline.runway, timeToReset }),
  };
}

export function formatResetLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatRunway(runway: number, unit: PaceUnit): string {
  const digits = runway >= 10 ? 0 : 1;
  const value = runway.toFixed(digits).replace(/\.0$/, "");
  return unit === "hour" ? `${value}h left` : `${value}d left`;
}

export function formatLookbackLine(lookback: PaceLookback): string {
  if (lookback.runway == null && (lookback.burnPerUnit == null || lookback.burnPerUnit === 0)) {
    return lookback.burnPerUnit == null ? `${lookback.label}: unknown` : `${lookback.label}: not burning`;
  }
  if (lookback.runway == null) return `${lookback.label}: not burning`;
  return `${lookback.label}: ${formatRunway(lookback.runway, lookback.unit)}`;
}

export function leftoverAtReset(pace: PaceResult): {
  emptiesBeforeReset: boolean;
  leftoverPct: number | null;
} {
  if (pace.remainingPct == null || pace.timeToReset == null) {
    return { emptiesBeforeReset: false, leftoverPct: null };
  }
  if (pace.headline?.burnPerUnit == null || pace.headline.burnPerUnit === 0) {
    return { emptiesBeforeReset: false, leftoverPct: pace.remainingPct };
  }
  const leftover = pace.remainingPct - pace.headline.burnPerUnit * pace.timeToReset;
  if (leftover <= 0) return { emptiesBeforeReset: true, leftoverPct: 0 };
  return { emptiesBeforeReset: false, leftoverPct: leftover };
}

export function formatLeftoverLine(pace: PaceResult): string | null {
  const leftover = leftoverAtReset(pace);
  if (leftover.leftoverPct == null) return null;
  if (leftover.emptiesBeforeReset) return "empties before reset";
  const digits = leftover.leftoverPct >= 10 ? 0 : 1;
  return `≈ ${leftover.leftoverPct.toFixed(digits).replace(/\.0$/, "")}% unused at reset`;
}

export function paceToneLabel(tone: PaceTone): string {
  switch (tone) {
    case "super_critical": return "Super critical";
    case "critical": return "Critical";
    case "warning": return "Warning";
    case "over_pace": return "Over-pace";
    case "on_track": return "On track";
    case "under_using": return "Under-using";
    case "idle": return "Not burning";
    default: return "Unknown";
  }
}

export function paceToneClass(tone: PaceTone): string {
  switch (tone) {
    case "super_critical": return "text-destructive font-semibold";
    case "critical": return "text-destructive";
    case "warning":
    case "over_pace":
      return "text-warning";
    case "on_track": return "text-success";
    case "under_using":
    case "idle":
      return "text-muted-foreground";
    default: return "text-muted-foreground/60";
  }
}

export function formatPaceLine(pace: PaceResult): string {
  const label = pace.headline?.label ?? (pace.unit === "hour" ? "5H" : "7D");
  let body = "unknown";
  if (pace.tone === "idle") body = "not burning";
  else if (pace.headline?.runway != null) body = formatRunway(pace.headline.runway, pace.headline.unit);
  const reset = pace.nextResetAt ? ` · reset ${formatResetLabel(pace.nextResetAt)}` : "";
  return `${label}: ${body}${reset}`;
}
