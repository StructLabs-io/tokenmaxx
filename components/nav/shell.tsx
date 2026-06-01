"use client";

/**
 * Layout shell that wraps the sidebar + main content with a collapsible
 * sidebar. The collapse state persists across pages (localStorage) so the
 * choice sticks. A floating toggle button shows when the sidebar is hidden.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/nav/sidebar";
import { AutoRefresh } from "@/components/nav/auto-refresh";
import { PanelLeftOpen } from "lucide-react";

const STORAGE_KEY = "tokenmaxx:sidebar-collapsed";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
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
      <AutoRefresh />
      {collapsed ? (
        // Thin rail with just the open-sidebar button — keeps it off the page title.
        <div className="w-10 flex-shrink-0 border-r border-border bg-sidebar flex items-start justify-center pt-4">
          <button
            type="button"
            onClick={toggle}
            aria-label="Show sidebar"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="w-56 flex-shrink-0">
          <Sidebar onToggle={toggle} />
        </div>
      )}
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
