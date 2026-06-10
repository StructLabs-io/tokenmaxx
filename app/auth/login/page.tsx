"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Zap, Mail, KeyRound } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";

function LoginContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const [mode, setMode] = useState<"password" | "magic">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const forbidden = sp.get("forbidden") === "1";

  // Only accept same-origin relative paths to prevent open-redirects.
  // `//evil.com` is a protocol-relative URL — most user agents treat it as cross-origin.
  function safeRelative(p: string | null): string {
    if (!p || !p.startsWith("/") || p.startsWith("//")) return "/";
    return p;
  }

  function sb() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push(safeRelative(sp.get("from")));
    router.refresh();
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    const { error } = await sb().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeRelative(sp.get("from")))}` },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setInfo(`Magic link sent to ${email}. Check your inbox.`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold tracking-tight">{BRAND_NAME}</span>
        </div>

        <Card className="border-border bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium text-card-foreground">Sign in</CardTitle>
            {forbidden && (
              <p className="text-xs text-destructive mt-1">
                That account isn&apos;t authorised for this workspace.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode toggle */}
            <div className="inline-flex w-full rounded-md border border-border p-0.5 text-xs bg-muted/40">
              <button type="button"
                className={`flex-1 px-3 py-1.5 rounded inline-flex items-center justify-center gap-1.5 ${mode === "magic" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                onClick={() => setMode("magic")}>
                <Mail className="h-3 w-3" /> Magic link
              </button>
              <button type="button"
                className={`flex-1 px-3 py-1.5 rounded inline-flex items-center justify-center gap-1.5 ${mode === "password" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                onClick={() => setMode("password")}>
                <KeyRound className="h-3 w-3" /> Password
              </button>
            </div>

            <form onSubmit={mode === "magic" ? handleMagic : handlePassword} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium text-muted-foreground">Email</label>
                <Input id="email" type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="bg-background" />
              </div>

              {mode === "password" && (
                <div className="space-y-1.5">
                  <label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</label>
                  <Input id="password" type="password" autoComplete="current-password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-background" />
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
              {info && <p className="text-xs text-success">{info}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Working…" : mode === "magic" ? "Send magic link" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
