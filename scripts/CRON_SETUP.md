# Tokenmaxx Pipeline Cron Setup

## Scripts overview

| Script | Purpose | Frequency |
|---|---|---|
| `pricing-pull.js` | Fetch current model pricing from OpenRouter -> Supabase `pricing_snapshots` | Daily |
| `manual-pricing-seed.js` | Seed static pricing for models not on OpenRouter | Run once / on model changes |
| `fx-rate.js` | Fetch USD->MYR + USD->SGD rates -> Supabase `fx_rates` | Daily |
| `server-capture.js` | Capture OpenClaw server JSONL events -> Supabase `usage_events` | Daily (runs after cron completes) |
| `local-capture.js` | Capture MacBook Codex session files -> Supabase `usage_events` | Daily or on-demand |
| `quota-tier1.js` | Read Code Meter widget-data.json -> Supabase `quota_observations` | Every 15 min (MacBook only) |
| `quota-tier2.js` | Fetch claude.ai quota via session cookie -> Supabase `quota_observations` | Every 15 min (n9c server or MacBook) |

## Environment variables required

All scripts use:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Capture scripts also need:
```
TOKENMAXX_WORKSPACE_ID=your-workspace-uuid
TOKENMAXX_USER_SLUG=ben-macbook          # or openclaw-server
```

## MacBook crontab

Add via `crontab -e`:

```cron
# Tokenmaxx — local capture (runs once daily at 23:45 local time)
45 23 * * * cd /Users/benauknowra/Projects/public/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  TOKENMAXX_WORKSPACE_ID=<workspace_uuid> \
  TOKENMAXX_USER_SLUG=ben-macbook \
  node scripts/local-capture.js >> /tmp/tokenmaxx-local-capture.log 2>&1

# Tokenmaxx — fx rate (runs at 23:50 daily)
50 23 * * * cd /Users/benauknowra/Projects/public/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  node scripts/fx-rate.js >> /tmp/tokenmaxx-fx-rate.log 2>&1

# Tokenmaxx — pricing pull (runs weekly on Sunday at 23:55)
55 23 * * 0 cd /Users/benauknowra/Projects/public/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  node scripts/pricing-pull.js >> /tmp/tokenmaxx-pricing-pull.log 2>&1
```

Replace `<prod_url>`, `<service_role_key>`, `<workspace_uuid>` with values from `shared/.env`.

## n9c server crontab

SSH to n9c server, then `crontab -e`:

```cron
# Tokenmaxx — server capture (runs daily at 00:05 UTC, after midnight cron runs complete)
5 0 * * * cd /home/openclaw/scripts/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  TOKENMAXX_WORKSPACE_ID=<workspace_uuid> \
  TOKENMAXX_USER_SLUG=openclaw-server \
  node server-capture.js >> /home/openclaw/logs/tokenmaxx-server-capture.log 2>&1

# Tokenmaxx — fx rate (runs daily at 00:10 UTC)
10 0 * * * cd /home/openclaw/scripts/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  node fx-rate.js >> /home/openclaw/logs/tokenmaxx-fx-rate.log 2>&1

# Tokenmaxx — pricing pull (runs weekly on Monday at 00:15 UTC)
15 0 * * 1 cd /home/openclaw/scripts/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  node pricing-pull.js >> /home/openclaw/logs/tokenmaxx-pricing-pull.log 2>&1
```

## Installing scripts on the n9c server

1. Copy scripts to server:
   ```bash
   rsync -av /Users/benauknowra/Projects/public/tokenmaxx/scripts/ \
     openclaw@<server-ip>:/home/openclaw/scripts/tokenmaxx/
   ```

2. Verify Node.js is available:
   ```bash
   ssh openclaw@<server-ip> 'node --version'
   ```

3. Create log directory:
   ```bash
   ssh openclaw@<server-ip> 'mkdir -p /home/openclaw/logs'
   ```

4. Test dry-run before activating cron:
   ```bash
   ssh openclaw@<server-ip> 'cd /home/openclaw/scripts/tokenmaxx && \
     SUPABASE_URL=<prod_url> SUPABASE_SERVICE_ROLE_KEY=<key> \
     TOKENMAXX_WORKSPACE_ID=<uuid> TOKENMAXX_USER_SLUG=openclaw-server \
     node server-capture.js --dry-run'
   ```

## Quota Tier 1 (MacBook only — requires Code Meter running)

Add to MacBook crontab via `crontab -e`:

```cron
# Tokenmaxx — quota tier 1 (Code Meter widget, every 15 min)
*/15 * * * * cd /Users/benauknowra/Projects/public/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  node scripts/quota-tier1.js >> ~/.config/tokenmaxx/quota-tier1.log 2>&1
```

Non-fatal if Code Meter is not running — script exits 0 if widget-data.json not found.

## Quota Tier 2 (n9c server or MacBook)

Requires `CLAUDE_ORG_ID` and `CLAUDE_SESSION_KEY` in environment.
See `scripts/.env.example` for how to obtain the session key.

```cron
# Tokenmaxx — quota tier 2 (claude.ai API, every 15 min)
*/15 * * * * cd /Users/benauknowra/Projects/public/tokenmaxx && \
  SUPABASE_URL=<prod_url> \
  SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
  CLAUDE_ORG_ID=<your_org_id> \
  CLAUDE_SESSION_KEY=<your_session_key> \
  node scripts/quota-tier2.js >> ~/.config/tokenmaxx/quota-tier2.log 2>&1
```

Script self-rate-limits at 10 min — safe to run every 15 min from cron.
Session keys expire; re-copy from DevTools when you see 401 errors in the log.

## Quota Rule Evaluation

After Tier 1 or Tier 2 scripts run, call the `evaluate-quota-rules` Edge Function
to check alert thresholds and fire Telegram notifications.

**Manual invocation pattern** (pipe from after quota script, or add as separate cron step):

```bash
# Evaluate rules for quota_window_id=1 (Claude Max 5h rolling) at current percent
curl -s -X POST \
  "https://ewaknihwrzysakbtjzlx.supabase.co/functions/v1/evaluate-quota-rules" \
  -H "Content-Type: application/json" \
  -d '{"quota_window_id": 1, "percent_used": <PERCENT>}'
```

For automated evaluation, add a cron step that:
1. Queries the latest `quota_observations` row for the window
2. POSTs to `evaluate-quota-rules` with that observation's `quota_window_id` + `percent_used`

pg_cron wiring (optional, deferred): A pg_net call from pg_cron can be added to
auto-evaluate on `quota_observations` INSERT. Not yet wired — use the pattern above.

## State files

Each capture script maintains a state file to track already-processed JSONL sessions:
- MacBook: `~/.config/tokenmaxx/local-state.json`
- Server: `/home/openclaw/.config/tokenmaxx/server-state.json`

These are created automatically on first run. Do not delete them — it would cause duplicate events.

## Manual backfill

To backfill server events for a date range:
```bash
node scripts/server-capture.js --backfill 2026-01-01
```

To backfill fx rates manually (ExchangeRate-API free tier only provides current rates):
```bash
# Seed a specific historical date (if you have the rate)
SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
  node scripts/fx-rate.js --date 2026-01-01
```
Note: The free ExchangeRate-API endpoint only returns live rates. For historical backfill, use the paid tier or seed manually via psql.
