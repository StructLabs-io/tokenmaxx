import { describe, expect, it } from "vitest";
import {
  formatLeftoverLine,
  formatLookbackLine,
  formatPaceLine,
  leftoverAtReset,
  paceRunway,
  paceToneLabel,
  resolveCostFromRaw,
  resolveNextResetAt,
  resolvePeriodStart,
  type PaceObservation,
} from "../quota-pace";

const NOW = new Date("2026-09-17T08:00:00.000Z");

function hoursAgo(hours: number, percent: number): PaceObservation {
  return {
    observed_at: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
    percent_used: percent,
  };
}

function daysAgo(days: number, percent: number): PaceObservation {
  return hoursAgo(days * 24, percent);
}

describe("resolveNextResetAt", () => {
  it("reads Claude resets_at", () => {
    expect(resolveNextResetAt({ resets_at: "2026-09-18T07:00:00.000Z" })).toBe("2026-09-18T07:00:00.000Z");
  });

  it("reads Cursor Grok nextResetAt and billingCycleEnd", () => {
    expect(resolveNextResetAt({ nextResetAt: "2026-09-22T00:00:00.000Z" })).toBe("2026-09-22T00:00:00.000Z");
    expect(resolveNextResetAt({ billingCycleEnd: "2026-10-05T08:42:20.000Z" })).toBe(
      "2026-10-05T08:42:20.000Z",
    );
  });

  it("reads Codex epoch reset from the matching rate-limit window", () => {
    const raw = {
      rate_limit: {
        primary_window: { reset_at: 1_758_110_400 },
        secondary_window: { reset_at: 1_758_628_800 },
      },
    };
    expect(resolveNextResetAt(raw, "rolling_hours")).toBe(new Date(1_758_110_400 * 1000).toISOString());
    expect(resolveNextResetAt(raw, "calendar_week")).toBe(new Date(1_758_628_800 * 1000).toISOString());
  });

  it("prefers nextResetAt over billingCycleEnd", () => {
    expect(resolveNextResetAt({
      nextResetAt: "2026-09-22T00:00:00.000Z",
      billingCycleEnd: "2026-10-05T08:42:20.000Z",
    })).toBe("2026-09-22T00:00:00.000Z");
  });
});

describe("resolvePeriodStart and cost", () => {
  it("reads currentPeriodStart then billingCycleStart", () => {
    expect(resolvePeriodStart({ currentPeriodStart: "2026-09-01T00:00:00.000Z" })).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(resolvePeriodStart({ billingCycleStart: "2026-09-05T08:42:20.000Z" })).toBe(
      "2026-09-05T08:42:20.000Z",
    );
  });

  it("reads Other Models cents as USD", () => {
    expect(resolveCostFromRaw({ planUsedCents: 7000, planLimitCents: 7000 })).toEqual({
      costUsedUsd: 70,
      costCapUsd: 70,
    });
  });
});

describe("paceRunway weekly / account period", () => {
  it("reports remaining from the latest percent_used", () => {
    const pace = paceRunway({
      observations: [daysAgo(2, 40), daysAgo(0, 52)],
      windowType: "calendar_week",
      now: NOW,
    });
    expect(pace.remainingPct).toBe(48);
  });

  it("treats zero burn as idle / not burning", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 20), daysAgo(0, 20)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-22T00:00:00.000Z",
      now: NOW,
    });
    expect(pace.tone).toBe("idle");
    expect(pace.headline?.runway).toBeNull();
    expect(formatPaceLine(pace)).toContain("not burning");
  });

  it("computes 7D runway as remaining / burn-per-day", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 20), daysAgo(0, 50)],
      windowType: "account_period",
      nextResetAt: "2026-10-05T08:00:00.000Z",
      now: NOW,
    });
    const seven = pace.lookbacks.find((row) => row.id === "7d");
    expect(seven?.burnPerUnit).toBeCloseTo(30 / 7, 5);
    expect(seven?.runway).toBeCloseTo(50 / (30 / 7), 5);
    expect(seven?.unit).toBe("day");
    expect(pace.headline?.id).toBe("7d");
  });

  it("ignores a reset drop and clips lookback to post-reset samples", () => {
    const pace = paceRunway({
      observations: [
        daysAgo(8, 90),
        daysAgo(7, 5),
        daysAgo(0, 19),
      ],
      windowType: "calendar_week",
      nextResetAt: "2026-09-24T00:00:00.000Z",
      now: NOW,
    });
    const seven = pace.lookbacks.find((row) => row.id === "7d");
    expect(seven?.burnPerUnit).toBeCloseTo(14 / 7, 5);
    expect(seven?.runway).toBeCloseTo(81 / (14 / 7), 5);
  });

  it("does not let 1D include pre-reset usage", () => {
    const pace = paceRunway({
      observations: [
        hoursAgo(30, 80),
        hoursAgo(20, 4),
        hoursAgo(0, 16),
      ],
      windowType: "calendar_week",
      now: NOW,
    });
    const one = pace.lookbacks.find((row) => row.id === "1d");
    expect(one?.burnPerUnit).toBeCloseTo((12) / (20 / 24), 4);
  });

  it("marks remaining ~0 as super_critical", () => {
    const pace = paceRunway({
      observations: [daysAgo(1, 99.8)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-24T00:00:00.000Z",
      now: NOW,
    });
    expect(pace.tone).toBe("super_critical");
  });

  it("marks 7D runway under 1 day as super_critical even if reset is later", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 20), daysAgo(0, 95)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-24T00:00:00.000Z",
      now: NOW,
    });
    expect(pace.headline?.runway).toBeLessThan(1);
    expect(pace.tone).toBe("super_critical");
  });

  it("marks 7D runway under 3 days and before reset as critical", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 10), daysAgo(0, 80)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-24T00:00:00.000Z",
      now: NOW,
    });
    expect(pace.headline?.runway).toBeGreaterThan(1);
    expect(pace.headline?.runway).toBeLessThan(3);
    expect(pace.tone).toBe("critical");
  });

  it("marks 7D runway under 7 days and before reset as warning", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 48), daysAgo(0, 80)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-27T08:00:00.000Z",
      now: NOW,
    });
    expect(pace.headline?.runway).toBeGreaterThan(3);
    expect(pace.headline?.runway).toBeLessThan(7);
    expect(pace.tone).toBe("warning");
  });

  it("marks emptying before a distant reset with runway >= 7d as over_pace", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 32), daysAgo(0, 60)],
      windowType: "account_period",
      nextResetAt: "2026-10-05T08:00:00.000Z",
      now: NOW,
    });
    expect(pace.headline?.runway).toBeGreaterThanOrEqual(7);
    expect(pace.tone).toBe("over_pace");
  });

  it("marks runway longer than days-to-reset as under_using", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 10), daysAgo(0, 12)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-20T08:00:00.000Z",
      now: NOW,
    });
    expect(pace.tone).toBe("under_using");
  });

  it("marks runway matching days-to-reset as on_track", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 30), daysAgo(0, 65)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-24T08:00:00.000Z",
      now: NOW,
    });
    expect(pace.tone).toBe("on_track");
  });

  it("does not include a 30D lookback for rolling 5h windows", () => {
    const pace = paceRunway({
      observations: [hoursAgo(4, 20), hoursAgo(0, 40)],
      windowType: "rolling_hours",
      windowHours: 5,
      nextResetAt: "2026-09-17T12:00:00.000Z",
      now: NOW,
    });
    expect(pace.lookbacks.map((row) => row.id)).toEqual(["1h", "5h"]);
    expect(pace.headline?.id).toBe("5h");
    expect(pace.headline?.unit).toBe("hour");
  });

  it("uses hours-to-reset tones for 5h windows", () => {
    const pace = paceRunway({
      observations: [hoursAgo(1, 50), hoursAgo(0, 80)],
      windowType: "rolling_hours",
      windowHours: 5,
      nextResetAt: "2026-09-17T12:00:00.000Z",
      now: NOW,
    });
    expect(pace.headline?.runway).toBeCloseTo(20 / 30, 5);
    expect(pace.tone).toBe("super_critical");
  });
});

describe("formatPaceLine", () => {
  it("renders the 7D headline with reset in MYT", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 20), daysAgo(0, 50)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-22T07:00:00.000Z",
      now: NOW,
    });
    expect(formatPaceLine(pace)).toMatch(/^7D: \d+(\.\d)?d left · reset /);
  });
});

describe("leftover vs empty", () => {
  it("says empties before reset when 7D burn exhausts the remainder", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 32), daysAgo(0, 60)],
      windowType: "account_period",
      nextResetAt: "2026-10-05T08:00:00.000Z",
      now: NOW,
    });
    expect(leftoverAtReset(pace).emptiesBeforeReset).toBe(true);
    expect(formatLeftoverLine(pace)).toBe("empties before reset");
  });

  it("reports leftover percent when under-using", () => {
    const pace = paceRunway({
      observations: [daysAgo(7, 10), daysAgo(0, 12)],
      windowType: "calendar_week",
      nextResetAt: "2026-09-20T08:00:00.000Z",
      now: NOW,
    });
    expect(leftoverAtReset(pace).emptiesBeforeReset).toBe(false);
    expect(leftoverAtReset(pace).leftoverPct).toBeGreaterThan(0);
    expect(formatLeftoverLine(pace)).toMatch(/unused at reset/);
    expect(formatLookbackLine(pace.lookbacks[1])).toMatch(/^7D: /);
    expect(paceToneLabel(pace.tone)).toBe("Under-using");
  });
});
