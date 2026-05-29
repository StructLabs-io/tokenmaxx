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
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **recharts** for usage charts

## Getting started

```bash
npm install
npm run dev
```

To build and preview for Cloudflare:

```bash
npm run build:cf   # runs opennextjs-cloudflare build → .open-next/
npm run preview    # runs opennextjs-cloudflare preview via wrangler dev
npm run deploy     # deploys to Cloudflare Workers (requires wrangler login)
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Until these are set, the app renders seed data from `lib/seed-data.ts`.

## Known constraints (MVP)

### Cloudflare Workers / `@opennextjs/cloudflare`

- **Edge runtime for API routes.** API routes that use Node.js APIs or server-only features must declare `export const runtime = "edge"`. The health route at `/api/health` already does this.
- **Node.js compat via flag.** Standard Node.js APIs work when `nodejs_compat` is enabled in `wrangler.jsonc` (already set). Most Next.js server features work without declaring edge runtime explicitly.
- **No ISR.** Incremental Static Regeneration is not supported. Pages are either statically prerendered or dynamically server-rendered.
- **No PPR.** Partial Prerendering is not supported.
- **Static assets served from Workers Assets.** The `.open-next/assets` directory is bound as `ASSETS` in `wrangler.jsonc`. No separate Pages project needed -- this deploys as a standard Worker.
- **Image optimization is disabled.** `images: { unoptimized: true }` is set in `next.config.mjs`. Use a CDN or CF Image Resizing for production.
- **Streaming responses.** `@opennextjs/cloudflare` supports streaming SSR (unlike the old adapter). Streaming is available but not used in the current MVP.
- **Build output.** `npm run build:cf` writes to `.open-next/`. The `.next/` directory is still created by `npm run build` (Next.js standard build) and is not deployed.

### Supabase

- Realtime subscriptions (`/raw` page) are inactive until Supabase is provisioned.
- Auth is not wired -- v0.1 is single-user, no sign-in flow.

## Seed data

`lib/seed-data.ts` contains 14 days of synthetic usage events, 5 fake projects, 3 users, and 4 quota windows. All data is fictional. This is swapped for real Supabase queries once credentials are configured.

## License

Apache-2.0
