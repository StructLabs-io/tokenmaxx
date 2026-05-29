# Setup — What Your AI Agent Can Do

**Version:** v0.1
**Status:** Draft — pending Ben's review
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | An AI agent | Initial agent setup guide |

---

This guide is written for an AI agent (Claude Code, Codex, or similar) helping a human set up Tokenmaxx.

**Read [SETUP-HUMAN.md](SETUP-HUMAN.md) first.** Your human must complete those steps before you begin. Check each prerequisite before proceeding.

---

## Prerequisites check

Before starting, verify:

1. Supabase project URL and service-role key are in `~/.config/tokenmaxx/.env` — run `cat ~/.config/tokenmaxx/.env` and confirm the values are present and non-empty
2. Cloudflare Pages project exists and is connected to the repo — ask the human to confirm the Pages project URL
3. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the Pages environment — ask the human to confirm
4. Node.js 18+ is installed on the machine you're operating on

If any prerequisite is missing, surface the gap and stop. Do not attempt to create Supabase projects, Cloudflare accounts, or API keys — those are human-only steps.

---

## Step 1 — Apply schema migrations

From the repo root:

```bash
# Install Supabase CLI if not present
npm install -g supabase

# Link to the project (requires SUPABASE_PROJECT_REF from the project URL)
# e.g. if URL is https://abcdefghij.supabase.co, ref is "abcdefghij"
supabase link --project-ref <ref>

# Apply all migrations in order
supabase db push
```

Verify success by checking that the following tables exist in Supabase Studio → Table Editor:
- `workspaces`, `users`, `workspace_members`
- `subscriptions`, `subscription_members`
- `projects`, `toggl_entries`
- `usage_events`
- `quota_windows`, `quota_observations`
- `pricing_snapshots`, `fx_rates`
- `attribution_overrides`

If any migration fails, check the error message, fix the migration file, and re-run.

---

## Step 2 — Seed initial workspace and user rows

Tokenmaxx uses a workspace model. Insert the human's workspace and user manually for v0.1 (no auth UI yet):

```sql
-- Run in Supabase Studio → SQL Editor

insert into workspaces (slug, display_name, timezone)
values ('my-workspace', 'My Workspace', 'Asia/Kuala_Lumpur');  -- adjust timezone

insert into users (slug, display_name, account_type, email)
values ('my-laptop', 'My Laptop', 'service', null);

insert into workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'admin'
from workspaces w, users u
where w.slug = 'my-workspace' and u.slug = 'my-laptop';
```

Update `TOKENMAXX_WORKSPACE_SLUG` and `TOKENMAXX_USER_SLUG` in `~/.config/tokenmaxx/.env` to match the slugs you inserted.

For a server (e.g. a VPS running AI tools), add a second `users` row with a different slug and repeat the `workspace_members` insert.

---

## Step 3 — Install Node dependencies and test a capture run

```bash
# From repo root
npm install

# Test local capture script (dry run)
node scripts/local-capture.js --dry-run

# If dry run succeeds, run for real
node scripts/local-capture.js
```

Check the output log at `~/.config/tokenmaxx/logs/local-capture-<today>.log`. You should see rows inserted or "nothing new to capture."

If the script exits with an error, read the log and fix the issue before proceeding.

---

## Step 4 — Configure the capture cron

Add to the human's crontab (`crontab -e`):

```cron
# Tokenmaxx local capture — runs daily at 05:00 local time
0 5 * * * /usr/bin/node /path/to/tokenmaxx/scripts/local-capture.js >> ~/.config/tokenmaxx/logs/cron.log 2>&1
```

Adjust the path to match the repo location and the Node binary path (`which node`).

For a server running additional AI tools, also add an entry for `scripts/server-capture.js` using the server's Node binary and the server's `.env` path.

---

## Step 5 — Deploy Edge Functions

```bash
# Deploy all Edge Functions to the linked Supabase project
supabase functions deploy toggl-sync
supabase functions deploy pricing-pull
supabase functions deploy fx-rate
supabase functions deploy daily-telegram
supabase functions deploy attribute-events
```

Verify each function appears in Supabase Dashboard → Edge Functions.

If the human set up Telegram (see SETUP-HUMAN.md Step 6), the `daily-telegram` function will use the Vault secrets automatically.

---

## Step 6 — Configure pg_cron schedules

In Supabase Studio → SQL Editor, apply the pg_cron migration:

```bash
supabase db push --include-all  # if not already done above
```

Or run the cron schedule SQL directly from `migrations/012_pg_cron_schedules.sql`. Verify in Studio → Database → Cron Jobs that the following jobs are listed:
- `toggl-sync` (hourly)
- `pricing-pull` (daily)
- `fx-rate` (daily)
- `daily-telegram` (daily)
- `attribute-events` (every 6h)

---

## Step 7 — Deploy the Next.js app

If Cloudflare Pages is configured with auto-deploy from the connected repo:

```bash
git add .
git commit -m "feat: initial tokenmaxx setup"
git push origin main
```

Cloudflare Pages will build and deploy automatically. Monitor the build in the Pages dashboard. The first successful build takes 2–4 minutes.

Verify the dashboard loads at the Pages project URL. Check that:
- The `/` page renders without errors
- No "Failed to fetch" or CORS errors in the browser console

---

## Step 8 — Verify end-to-end with a test event

Insert a test usage event directly to confirm the full stack:

```sql
-- Supabase Studio → SQL Editor
insert into usage_events (
  workspace_id, user_id, captured_at, date_utc, date_local,
  provider, model, capture_method, aggregation_grain,
  input_tokens, output_tokens, token_share_pct
)
select
  w.id, u.id, now(), current_date, current_date,
  'anthropic', 'claude-sonnet-4-6', 'anthropic.claude_code.cli.personal_dev', 'session',
  1000, 500, 100.0
from workspaces w, users u
where w.slug = 'my-workspace' and u.slug = 'my-laptop';
```

Then open the dashboard `/raw` page. The test event should appear within a few seconds (Supabase Realtime). If it doesn't appear, check the browser console and the Supabase Realtime channel subscription.

Delete the test row after verification:

```sql
delete from usage_events where notes is null and input_tokens = 1000 and output_tokens = 500;
```

---

## Suggested skills and MCPs

If you have access to Supabase MCP, use it for the SQL steps — it handles connection, auth, and error surfacing automatically.

For cron configuration on Linux/Mac, the Bash tool is sufficient. No special MCP needed.

For Cloudflare Pages environment variables, use the Cloudflare dashboard directly or the `wrangler` CLI:

```bash
npx wrangler pages project list  # verify project exists
```

---

## Done

When all 8 steps pass:

- [ ] Schema migrations applied, all tables present
- [ ] Workspace and user rows seeded
- [ ] Local capture cron running (`crontab -l` shows the entry)
- [ ] Edge Functions deployed and showing in Supabase dashboard
- [ ] pg_cron jobs scheduled
- [ ] Dashboard renders at Cloudflare Pages URL
- [ ] Test event appeared in `/raw` feed

Report the results to the human and flag any steps that needed manual intervention or produced errors.
