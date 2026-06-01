export interface ThemeEntry {
  slug: string;                    // matches the [data-theme="..."] selector
  name: string;                    // display label
  description: string;             // one-liner shown in Settings
  supportsLightDark: boolean;      // false = dark-only (terminal); true = both
  defaultMode?: "light" | "dark";  // initial mode when this theme is selected
}

export const THEMES: ThemeEntry[] = [
  { slug: "electric",  name: "Electric",  description: "Dark, cyan & magenta — Tokenmaxx default identity", supportsLightDark: false, defaultMode: "dark" },
  { slug: "paper",     name: "Paper",     description: "Warm off-white, ink-black text, reading-room feel", supportsLightDark: true,  defaultMode: "light" },
  { slug: "terminal",  name: "Terminal",  description: "High-contrast green-on-black hacker terminal",       supportsLightDark: false, defaultMode: "dark" },
  { slug: "arctic",    name: "Arctic",    description: "Cool glacial blues & whites; deep ocean in dark",    supportsLightDark: true,  defaultMode: "light" },
  { slug: "sunset",    name: "Sunset",    description: "Warm amber/coral light; dusk purple in dark",        supportsLightDark: true,  defaultMode: "light" },
  { slug: "brutalist", name: "Brutalist", description: "Stark monochrome + one saturated accent",            supportsLightDark: true,  defaultMode: "light" },
];

export const DEFAULT_THEME_SLUG =
  process.env.NEXT_PUBLIC_TOKENMAXX_DEFAULT_THEME ?? "electric";
