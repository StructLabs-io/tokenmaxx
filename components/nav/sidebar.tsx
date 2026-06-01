"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart2,
  FolderKanban,
  Table2,
  Zap,
  Cpu,
  CreditCard,
  Gauge,
  Sparkles,
  GitMerge,
  LogOut,
  Users,
  Github,
  Settings,
  PanelLeftClose,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/usage",
    label: "Usage",
    icon: BarChart2,
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
  },
  {
    href: "/raw",
    label: "Raw Events",
    icon: Table2,
  },
  {
    href: "/models",
    label: "Models",
    icon: Cpu,
  },
  {
    href: "/subscriptions",
    label: "Subscriptions",
    icon: CreditCard,
  },
  {
    href: "/quota",
    label: "Quota",
    icon: Gauge,
  },
  {
    href: "/wrap",
    label: "Wrapped",
    icon: Sparkles,
  },
  {
    href: "/reconcile",
    label: "Reconcile",
    icon: GitMerge,
  },
  {
    href: "/users",
    label: "Users",
    icon: Users,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
  },
];

export function Sidebar({ onToggle }: { onToggle?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo / wordmark */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            Tokenmaxx
          </span>
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Hide sidebar"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-2 py-3 space-y-1">
        <a
          href="https://github.com/StructLabs-io/tokenmaxx"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-full px-3 py-1.5 text-xs text-sidebar-foreground border border-sidebar-border transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-fit"
        >
          <Github className="h-3.5 w-3.5 shrink-0" />
          Public repo
        </a>
        <form action="/auth/logout" method="POST">
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
