"use client";

/**
 * Layout shell that wraps the sidebar + main content with a collapsible
 * sidebar. The collapse state persists across pages (localStorage) so the
 * choice sticks. A floating toggle button shows when the sidebar is hidden.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/nav/sidebar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "tokenmaxx:sidebar-collapsed";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();
  // Auth pages stand alone — no sidebar, no toggle.
  if (pathname?.startsWith("/auth/")) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {}
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — width collapses to 0 when hidden */}
      <div
        className={`transition-[width] duration-200 overflow-hidden ${
          collapsed ? "w-0" : "w-56"
        }`}
      >
        <Sidebar />
      </div>
      <main className="flex-1 overflow-y-auto bg-background relative">
        {/* Toggle button — pinned top-left of the content area */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
          className="fixed top-3 left-3 z-50 inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
          style={{ left: collapsed ? "12px" : "calc(224px + 12px)" }}
        >
          {hydrated && (collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />)}
        </button>
        {children}
      </main>
    </div>
  );
}
