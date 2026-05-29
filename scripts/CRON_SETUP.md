# Tokenmaxx Pipeline Cron Setup

## Scripts overview

| Script | Purpose | Frequency |
|---|---|---|
| `pricing-pull.js` | Fetch current model pricing from OpenRouter -> Supabase `pricing_snapshots` | Daily |
| `manual-pricing-seed.js` | Seed static pricing for models not on OpenRouter | Run once / on model changes |
| `fx-rate.js` | Fetch USD->MYR + USD->SGD rates -> Supabase `fx_rates` | Daily |
| `server-capture.js` | Capture OpenClaw server JSONL events -> Supabase `usage_events` | Daily (runs after cron completes) |
| `local-capture.js` | Capture MacBook Codex session files -> Supabase `usage_events` | Daily or on-demand |

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
