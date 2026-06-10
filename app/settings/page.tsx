"use client";

/**
 * Settings page — user preferences for display + behaviour.
 * Persisted in localStorage (Preferences interface in lib/preferences.ts).
 * When auth lands (§11.3) migrates to a user_preferences DB table.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ALL_GRANULARITIES, DEFAULT_PREFS, loadPrefs, savePrefs, type Preferences } from "@/lib/preferences";
import { useTheme } from "@/lib/themes/use-theme";

const REFRESH_OPTIONS = [
  { sec: 0, label: "Off" },
  { sec: 30, label: "30s" },
  { sec: 60, label: "60s" },
  { sec: 300, label: "5m" },
  { sec: 900, label: "15m" },
];

const TIMEZONES = [
  "UTC",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Australia/Sydney",
];

export default function SettingsPage() {
  const { slug, mode, setTheme, toggleMode, themes, hydrated } = useTheme();
  const current = themes.find((t) => t.slug === slug);

  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      savePrefs(next);
      setSavedAt(new Date().toLocaleTimeString());
      return next;
    });
  }

  function toggleGranularity(id: string) {
    const has = prefs.enabledGranularities.includes(id as any);
    const next = has
      ? prefs.enabledGranularities.filter((g) => g !== id)
      : [...prefs.enabledGranularities, id as any];
    update("enabledGranularities", next as any);
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Display + behaviour preferences. Saved to this browser.
          </p>
        </div>
        {savedAt && <p className="text-xs text-success">Saved at {savedAt}</p>}
      </div>

      <Card>
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-medium">Appearance</CardTitle>
          <CardDescription>Choose a theme. Saved to this browser.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {themes.map((t) => {
              const isActive = hydrated && t.slug === slug;
              return (
                <Card
                  key={t.slug}
                  onClick={() => setTheme(t.slug)}
                  className={`cursor-pointer p-3 transition ${
                    isActive ? "ring-2 ring-ring" : "hover:bg-muted/40"
                  }`}
                >
                  {/* Swatch row: inline data-theme so each card previews its own palette */}
                  <div
                    data-theme={t.slug}
                    className="flex h-8 mb-2 rounded overflow-hidden border"
                  >
                    <div className="flex-1 bg-background" />
                    <div className="flex-1 bg-primary" />
                    <div className="flex-1 bg-accent" />
                    <div className="flex-1 bg-destructive" />
                  </div>
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
                  {!t.supportsLightDark && (
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1.5">
                      Dark only
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          {current?.supportsLightDark && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Mode</span>
              <Button variant="outline" size="sm" onClick={toggleMode}>
                {mode === "dark" ? "Switch to light" : "Switch to dark"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-medium">Display</CardTitle>
          <CardDescription>How dates, numbers, and times render across the app.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Timezone</label>
            <select
              value={prefs.timezone}
              onChange={(e) => update("timezone", e.target.value)}
              className="h-9 w-[260px] rounded-md border border-input bg-background px-3 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-medium">Auto-refresh</CardTitle>
          <CardDescription>How often dashboards re-fetch their server data automatically.</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <div className="flex flex-wrap gap-2">
            {REFRESH_OPTIONS.map((o) => (
              <Button
                key={o.sec}
                variant={prefs.autoRefreshSec === o.sec ? "default" : "outline"}
                size="sm"
                onClick={() => update("autoRefreshSec", o.sec)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-medium">Chart timeframe defaults</CardTitle>
          <CardDescription>What appears first when you open Dashboard / Usage.</CardDescription>
        </CardHeader>
        <CardContent className="px-5 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Default range</label>
            <div className="flex flex-wrap gap-1">
              {["1D", "3D", "7D", "14D", "30D"].map((r) => (
                <Button
                  key={r}
                  variant={prefs.defaultChartTimeframe === r ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => update("defaultChartTimeframe", r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Default dimension (stacked bars)</label>
            <div className="flex flex-wrap gap-1">
              {(["model", "project", "user", "provider", "source"] as const).map((d) => (
                <Button
                  key={d}
                  variant={prefs.defaultDimension === d ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => update("defaultDimension", d)}
                >
                  {d}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-5">
          <CardTitle className="text-sm font-medium">Chart granularities</CardTitle>
          <CardDescription>
            Which granularity options appear in the chart's bucket selector. Sub-hourly options
            only make sense when local-capture runs more frequently than daily — currently it
            runs daily at 23:45 MYT, so 1m/5m/15m bars will look sparse until that tightens.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_GRANULARITIES.map((g) => {
              const enabled = prefs.enabledGranularities.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGranularity(g.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs border ${
                    enabled
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <span className={`h-3 w-3 rounded border ${enabled ? "bg-primary border-primary" : "border-input"}`}>
                    {enabled && <span className="block text-[10px] text-primary-foreground leading-3 text-center">✓</span>}
                  </span>
                  {g.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
