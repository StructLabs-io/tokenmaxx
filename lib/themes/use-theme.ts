"use client";
import { useEffect, useState, useCallback } from "react";
import { THEMES, DEFAULT_THEME_SLUG } from "./registry";

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
