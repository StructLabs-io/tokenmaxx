# TokenMaxx theme system

Three things:

1. The Claude Designs prompt to generate themes
2. How themes are integrated in the app (Settings UI + registry)
3. How to add a new theme later

---

## 1. Claude Designs prompt

Paste this into Claude Designs. Output is six complete shadcn-compatible CSS theme blocks.

```
You're designing a set of complete UI themes for TokenMaxx — an AI
subscription usage-tracking dashboard. The app is built with Next.js 15,
shadcn/ui, and Tailwind v4. It's dark by default, data-dense (tables,
stacked-bar charts, dashboard tiles), and read primarily by one user
at a time who spends long sessions on it.

Generate 6 distinct, complete themes. Each theme is a CSS block exposing
the full shadcn variable set in HSL (no OKLCH, no hex). Light and dark
variants required for every theme except where I note "dark-only".

## Output format per theme

A 2-3 sentence designer's note (mood + use case + what it's best at),
followed by this CSS structure:

    /* === [slug] — [Display Name] === */
    [data-theme="[slug]"] {
      --background: H S% L%;
      --foreground: H S% L%;
      --card: H S% L%;
      --card-foreground: H S% L%;
      --popover: H S% L%;
      --popover-foreground: H S% L%;
      --primary: H S% L%;
      --primary-foreground: H S% L%;
      --secondary: H S% L%;
      --secondary-foreground: H S% L%;
      --muted: H S% L%;
      --muted-foreground: H S% L%;
      --accent: H S% L%;
      --accent-foreground: H S% L%;
      --destructive: H S% L%;
      --destructive-foreground: H S% L%;
      --border: H S% L%;
      --input: H S% L%;
      --ring: H S% L%;
      --radius: 0.5rem;          /* per-theme; vary 0.125rem – 0.75rem */
      --chart-1: H S% L%;
      --chart-2: H S% L%;
      --chart-3: H S% L%;
      --chart-4: H S% L%;
      --chart-5: H S% L%;
      --sidebar-background: H S% L%;
      --sidebar-foreground: H S% L%;
      --sidebar-primary: H S% L%;
      --sidebar-primary-foreground: H S% L%;
      --sidebar-accent: H S% L%;
      --sidebar-accent-foreground: H S% L%;
      --sidebar-border: H S% L%;
      --sidebar-ring: H S% L%;
    }

    [data-theme="[slug]"].dark {
      /* same variable set, dark values */
    }

Values are HSL space-separated WITHOUT the `hsl()` wrapper (e.g.
`240 5.9% 10%`, not `hsl(240, 5.9%, 10%)`). TokenMaxx wraps them at the
Tailwind layer.

## Themes to generate (in order)

1. electric — dark-only. Electric cyan (#00F0D0) + magenta (#FF2D7B) as
   primary/accent. Near-black background. This is TokenMaxx's existing
   identity; keep it recognisable.

2. paper — warm off-white background, ink-black text, ONE muted accent
   (your pick: terracotta, ochre, or navy). Reading-room feel. Dark
   variant uses warm dark grey, not pure black.

3. terminal — high-contrast green-on-black hacker terminal. Use a single
   green family (#00FF41 territory) for primary/accent/ring. Square
   corners (--radius: 0.125rem). Dark-only is fine; if you do a light
   variant, make it cream-on-dark-green.

4. arctic — cool light, glacial blues and whites. Saturated icy blue for
   primary. Dark variant: deep ocean (very dark navy-teal). Chart colors
   span hue without breaking the cool palette.

5. sunset — warm light, amber/coral/peach. Single saturated accent (your
   pick: deep orange or rose). Dark variant: dusk purple background with
   warm tints on text.

6. brutalist — stark monochrome (off-white / off-black) with ONE
   saturated accent (your pick). --radius: 0.125rem. Heavy border
   contrast (--border much closer to --foreground than usual).

## Constraints

- WCAG AA contrast: --foreground on --background ≥ 4.5:1; --muted-
  foreground on --background ≥ 3:1.
- The 5 chart colors must be visually distinct against the theme's
  background in BOTH light and dark variants. Don't reuse near-identical
  hues across chart-1..5.
- --destructive must read as "danger/error" — typically red, but tuned
  to the theme palette.
- --ring is the focus ring color; usually echoes --primary or --accent
  at higher chroma. Must be visible against --input.
- Sidebar tokens: --sidebar-background must contrast against the main
  --background enough that the sidebar reads as a distinct surface
  (typically 4-8% lightness delta).
- Don't use pure white (#FFF) or pure black (#000) for any surface
  unless the theme's mood demands it (terminal, brutalist).

## After all six themes

Output a markdown table:

| slug | display name | mood | best for | radius | light/dark |
|------|--------------|------|----------|--------|------------|

Then a one-paragraph "designer's defense" of why these six together
cover the useful range of moods for a data dashboard, and what's
deliberately NOT included.
```

---

## 2. App integration

### File layout

```
app/
  themes/
    electric.css        ← one file per theme
    paper.css
    terminal.css
    arctic.css
    sunset.css
    brutalist.css
    index.css           ← @import each theme file
  globals.css           ← @import "./themes/index.css"
lib/
  themes/
    registry.ts         ← single source of truth for the Settings UI
    use-theme.ts        ← hook: read + write `data-theme` attribute + localStorage
app/
  settings/
    appearance/
      page.tsx          ← swatch grid of THEMES with click-to-apply
docs/
  themes-system.md      ← this file
```

### `lib/themes/registry.ts`

```ts
export interface ThemeEntry {
  slug: string;                    // matches the [data-theme="..."] selector
  name: string;                    // display label
  description: string;             // one-liner shown in Settings
  supportsLightDark: boolean;      // false = dark-only (terminal); true = both
  defaultMode?: "light" | "dark";  // initial mode when this theme is selected
}

export const THEMES: ThemeEntry[] = [
  { slug: "electric",  name: "Electric",  description: "Dark, cyan & magenta — TokenMaxx default identity", supportsLightDark: false, defaultMode: "dark" },
  { slug: "paper",     name: "Paper",     description: "Warm off-white, ink-black text, reading-room feel", supportsLightDark: true,  defaultMode: "light" },
  { slug: "terminal",  name: "Terminal",  description: "High-contrast green-on-black hacker terminal",       supportsLightDark: false, defaultMode: "dark" },
  { slug: "arctic",    name: "Arctic",    description: "Cool glacial blues & whites; deep ocean in dark",    supportsLightDark: true,  defaultMode: "light" },
  { slug: "sunset",    name: "Sunset",    description: "Warm amber/coral light; dusk purple in dark",        supportsLightDark: true,  defaultMode: "light" },
  { slug: "brutalist", name: "Brutalist", description: "Stark monochrome + one saturated accent",            supportsLightDark: true,  defaultMode: "light" },
];

export const DEFAULT_THEME_SLUG =
  process.env.NEXT_PUBLIC_TOKENMAXX_DEFAULT_THEME ?? "electric";
```

### `lib/themes/use-theme.ts`

```ts
"use client";
import { useEffect, useState, useCallback } from "react";
import { THEMES, DEFAULT_THEME_SLUG, type ThemeEntry } from "./registry";

const KEY = "tokenmaxx:theme";

export function useTheme() {
  const [slug, setSlug] = useState<string>(DEFAULT_THEME_SLUG);
  const [mode, setMode] = useState<"light" | "dark">("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
        slug?: string; mode?: "light" | "dark";
      };
      const initialSlug = stored.slug ?? DEFAULT_THEME_SLUG;
      const entry = THEMES.find(t => t.slug === initialSlug) ?? THEMES[0];
      const initialMode = entry.supportsLightDark
        ? (stored.mode ?? entry.defaultMode ?? "dark")
        : (entry.defaultMode ?? "dark");
      apply(entry.slug, initialMode);
      setSlug(entry.slug);
      setMode(initialMode);
    } catch {}
    setHydrated(true);
  }, []);

  const setTheme = useCallback((nextSlug: string) => {
    const entry = THEMES.find(t => t.slug === nextSlug);
    if (!entry) return;
    const nextMode = entry.supportsLightDark ? mode : (entry.defaultMode ?? "dark");
    apply(entry.slug, nextMode);
    setSlug(entry.slug);
    setMode(nextMode);
    persist(entry.slug, nextMode);
  }, [mode]);

  const toggleMode = useCallback(() => {
    const entry = THEMES.find(t => t.slug === slug);
    if (!entry?.supportsLightDark) return;
    const next = mode === "dark" ? "light" : "dark";
    apply(slug, next);
    setMode(next);
    persist(slug, next);
  }, [slug, mode]);

  return { slug, mode, setTheme, toggleMode, hydrated, themes: THEMES };
}

function apply(slug: string, mode: "light" | "dark") {
  const html = document.documentElement;
  html.setAttribute("data-theme", slug);
  html.classList.toggle("dark", mode === "dark");
}

function persist(slug: string, mode: "light" | "dark") {
  try { localStorage.setItem(KEY, JSON.stringify({ slug, mode })); } catch {}
}
```

### `app/themes/index.css`

```css
@import "./electric.css";
@import "./paper.css";
@import "./terminal.css";
@import "./arctic.css";
@import "./sunset.css";
@import "./brutalist.css";
```

Then in `app/globals.css`, after the existing `:root` and `.dark` blocks:

```css
@import "./themes/index.css";
```

### `app/settings/appearance/page.tsx` (sketch)

A grid of swatches. Each card shows three colors (background, primary, accent), the theme name, and a one-line description. Clicking applies. A mode toggle (light/dark) appears only when `supportsLightDark` is true for the selected theme.

```tsx
"use client";
import { useTheme } from "@/lib/themes/use-theme";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AppearancePage() {
  const { slug, mode, setTheme, toggleMode, themes } = useTheme();
  const current = themes.find(t => t.slug === slug);
  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-xl font-medium mb-4">Appearance</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {themes.map(t => (
          <Card
            key={t.slug}
            onClick={() => setTheme(t.slug)}
            className={`cursor-pointer p-3 transition ${
              t.slug === slug ? "ring-2 ring-ring" : "hover:bg-muted/40"
            }`}
          >
            {/* swatch row uses inline data-theme so each preview shows ITS own colors */}
            <div data-theme={t.slug} className="flex h-10 mb-2 rounded overflow-hidden border">
              <div className="flex-1 bg-background" />
              <div className="flex-1 bg-primary" />
              <div className="flex-1 bg-accent" />
              <div className="flex-1 bg-destructive" />
            </div>
            <div className="text-sm font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
          </Card>
        ))}
      </div>
      {current?.supportsLightDark && (
        <div className="mt-6 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Mode</span>
          <Button variant="outline" size="sm" onClick={toggleMode}>
            {mode === "dark" ? "Switch to light" : "Switch to dark"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

### `app/layout.tsx` — boot the theme before paint

Add a small inline script in `<head>` so the theme applies pre-hydration and there's no FOUC:

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      try {
        var s = JSON.parse(localStorage.getItem('tokenmaxx:theme') || '{}');
        var slug = s.slug || '${"electric"}';
        var mode = s.mode || 'dark';
        document.documentElement.setAttribute('data-theme', slug);
        if (mode === 'dark') document.documentElement.classList.add('dark');
      } catch {}
    `,
  }}
/>
```

---

## 3. How to add a new theme

For users / future devs:

1. **Generate a theme block.** Paste the prompt above into Claude Designs. (For a single extra theme, replace the "Themes to generate" list with your single theme spec.)

2. **Save it.** Drop the CSS block into a new file at `app/themes/<slug>.css`. Keep the `[data-theme="<slug>"]` selectors intact.

3. **Wire the import.** Add `@import "./<slug>.css";` at the bottom of `app/themes/index.css`.

4. **Register it.** Add an entry to `THEMES` in `lib/themes/registry.ts`:

   ```ts
   {
     slug: "<slug>",
     name: "<Display Name>",
     description: "<one-liner>",
     supportsLightDark: true,        // false if dark-only
     defaultMode: "light",           // optional; "dark" if not set
   },
   ```

5. **Restart the dev server.** The theme appears in `Settings > Appearance`.

To make your new theme the app default, set:

```
NEXT_PUBLIC_TOKENMAXX_DEFAULT_THEME=<slug>
```

in `.env` (and on the maxx Docker container's `web.env`).

---

## Notes on the prompt's design choices

- **HSL not OKLCH.** TokenMaxx already ships HSL via shadcn's standard
  pattern. Mixing OKLCH would require Tailwind config changes; not
  worth it for the v1 system.
- **Six themes.** Fewer feels stingy; more becomes a wall in Settings.
  Six covers the practical mood range (default / soft / hacker / cool /
  warm / stark).
- **Per-theme radius.** Themes have a visual identity that's not just
  color — brutalist with rounded corners is wrong, terminal with rounded
  corners is wrong. Allowing radius per theme lets each be itself.
- **supportsLightDark flag.** Some themes (terminal, electric) only make
  sense in one mode. Exposing that in the registry keeps the Settings
  UI honest — no "switch to light mode" button on a dark-only theme.
