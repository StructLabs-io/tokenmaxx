"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function isConfigured(): boolean {
  return (
    SUPABASE_URL !== "" &&
    SUPABASE_URL !== "https://placeholder.supabase.co" &&
    SUPABASE_ANON_KEY !== "" &&
    SUPABASE_ANON_KEY !== "placeholder-anon-key"
  );
}

export function LiveTicker() {
  const [newEvents, setNewEvents] = useState(0);
  const router = useRouter();
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!isConfigured()) return;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const channel = supabase
      .channel("usage_events_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "usage_events" },
        () => {
          setNewEvents((n) => n + 1);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!isConfigured() || newEvents === 0) return null;

  return (
    <button
      onClick={() => {
        setNewEvents(0);
        router.refresh();
      }}
      className="flex items-center gap-1.5 focus:outline-none"
      aria-label="Refresh dashboard — new events arrived"
    >
      <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors flex items-center gap-1">
        <RefreshCw className="h-3 w-3" />
        {newEvents} new {newEvents === 1 ? "event" : "events"} — click to refresh
      </Badge>
    </button>
  );
}
