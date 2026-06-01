"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PREFS, loadPrefs } from "@/lib/preferences";

export function AutoRefresh() {
  const router = useRouter();
  const [sec, setSec] = useState<number>(DEFAULT_PREFS.autoRefreshSec);

  useEffect(() => { setSec(loadPrefs().autoRefreshSec); }, []);

  useEffect(() => {
    function onPrefs(e: any) { setSec(e.detail?.autoRefreshSec ?? DEFAULT_PREFS.autoRefreshSec); }
    window.addEventListener("tokenmaxx:prefs-changed", onPrefs as any);
    return () => window.removeEventListener("tokenmaxx:prefs-changed", onPrefs as any);
  }, []);

  useEffect(() => {
    if (!sec || sec < 5) return;
    const id = setInterval(() => router.refresh(), sec * 1000);
    return () => clearInterval(id);
  }, [sec, router]);

  return null;
}
