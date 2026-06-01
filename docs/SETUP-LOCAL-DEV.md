# Local Development Setup

**Version:** v0.1
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | Kenji Ryu | Initial local dev guide |

---

Run the full TokenMaxx stack on your laptop with no Supabase account and no cloud deployment. Uses Supabase CLI to boot a local Postgres + Studio instance in Docker.

---

## Prerequisites

- Node.js 22+
- Docker Desktop (running)
- Supabase CLI:

```bash
brew install supabase/tap/supabase
```

---

## Steps

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/tokenmaxx.git
cd tokenmaxx
npm install
```

### 2. Boot local Supabase

```bash
supabase start
```

This starts local Postgres, Auth, Storage, and Studio in Docker. First run pulls images (~500 MB). Subsequent starts are fast.

When it's ready, Supabase CLI prints the local credentials:

```
API URL: http://127.0.0.1:54321
Anon key: <local-anon-key>
Service role key: <local-service-role-key>
Studio URL: http://127.0.0.1:54323
```

### 3. Apply migrations

```bash
supabase db push
```

This applies all migrations in `migrations/` to your local Postgres.

### 4. Set up local environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the local values printed by `supabase start`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key>
```

### 5. Seed development data

```bash
npm run seed:dev
```

This loads the synthetic usage events, projects, users, and quota windows from `lib/seed-data.ts` into your local Postgres. Safe to run repeatedly — inserts use `ON CONFLICT DO NOTHING`.

### 6. Start the Next.js dev server

```bash
npm run dev
```

Dashboard at [http://localhost:3000](http://localhost:3000). Studio at [http://localhost:54323](http://localhost:54323).

---

## Stopping

```bash
supabase stop
```

Your local data persists between stops by default. To reset:

```bash
supabase stop --backup-file=false && supabase db reset
```

---

## Notes

- **No cron capture in local-dev mode by default.** The dashboard shows seed data only. To test real capture, run `node scripts/local-capture.js --dry-run` once schema is applied.
- **Local Postgres** is at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Studio** at `:54323` gives you a full SQL editor and table browser — useful when debugging migrations.
- When you're ready to move to a real Supabase project, see [SETUP-AGENT.md](SETUP-AGENT.md).
