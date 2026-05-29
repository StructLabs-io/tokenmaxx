# Tokenmaxx

AI subscription usage tracking and cost attribution dashboard.

**Status: Early WIP.** The app runs on seed data -- Supabase wiring is a follow-up step.

Full documentation will be in `docs/` once the project is further along.

---

## What it does

Tokenmaxx answers four questions about your AI subscriptions:

1. **Volume.** How many tokens did I generate, across what timeframes?
2. **Headroom.** Am I making the most of my Claude Max / Codex Pro subscription?
3. **Attribution.** What project did this spend go to?
4. **Team.** Who's using which subscription, how heavily, and is it justified?

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard -- today's tokens, 14-day trend, top projects, quota windows |
| `/usage` | Filterable time-series of usage events |
| `/projects` | Project list with AI cost totals |
| `/projects/[slug]` | Project detail -- token breakdown, daily timeline |
| `/raw` | Raw usage_events feed with search, filter, CSV export |
| `/api/health` | Edge health check |

## Stack

- **Next.js 15** + React 19 + TypeScript
- **Tailwind v4** + shadcn/ui (new-york style)
- **Supabase** (wired via `lib/supabase/client.ts` once provisioned)
- **Cloudflare Pages** via `@cloudflare/next-on-pages`
- **recharts** for usage charts

## Getting started

```bash
npm install
npm run dev
```

To build for Cloudflare Pages:

```bash
npm run pages:build    # runs @cloudflare/next-on-pages
npm run pages:dev      # serves the CF Pages output locally via wrangler
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Until these are set, the app renders seed data from `lib/seed-data.ts`.

## Known constraints (MVP)

### Cloudflare Pages / `@cloudflare/next-on-pages`

- **Edge runtime only.** All server-side code runs on CF Workers (Edge runtime), not Node.js. API routes must declare `export const runtime = "edge"`.
- **No Node.js middleware.** Middleware runs on the edge. Standard Node APIs are unavailable unless the `nodejs_compat` flag is enabled in `wrangler.toml`.
- **No ISR.** Incremental Static Regeneration is not supported via the `next-on-pages` adapter. Pages are either static or fully dynamic (`ƒ` in build output).
- **No PPR.** Partial Prerendering is not supported.
- **`@cloudflare/next-on-pages` is deprecated** (as of May 2025). Cloudflare recommends the `@opennextjs/cloudflare` adapter instead. Migration is a v0.2 task -- the current adapter works for v0.1 scope.
- **Next.js 15.3.2 has a known security vulnerability.** Upgrade to 15.3.3+ before public deployment.
- **Image optimization is disabled.** `images: { unoptimized: true }` is set in `next.config.mjs`. Use a CDN or CF Image Resizing for production.

### Supabase

- Realtime subscriptions (`/raw` page) are inactive until Supabase is provisioned.
- Auth is not wired -- v0.1 is single-user, no sign-in flow.

## Seed data

`lib/seed-data.ts` contains 14 days of synthetic usage events, 5 fake projects, 3 users, and 4 quota windows. All data is fictional. This is swapped for real Supabase queries once credentials are configured.

## License

Apache-2.0
