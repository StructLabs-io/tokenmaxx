# Setup — What Your AI Agent Does

**Version:** v0.2
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.2 | 2026-05-29 | Kenji Ryu | Rewritten as concrete agent-executable commands |
| v0.1 | 2026-05-29 | Human Approved | Initial agent setup guide |

---

This guide is written for an AI agent (Claude Code, Codex, or similar) setting up Tokenmaxx on behalf of a human.

**Read [SETUP-HUMAN.md](SETUP-HUMAN.md) first.** The human must complete those steps and have `.env.local` ready before you start.

---

## Prerequisites check

Before starting, verify:

```bash
# .env.local exists and has the required keys
cat .env.local | grep -E "SUPABASE_PAT|SUPABASE_ORG_ID|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID"
```

All four must be non-empty. If any are missing, stop and ask the human to complete [SETUP-HUMAN.md](SETUP-HUMAN.md).

Also verify Node.js 22+ and the Supabase CLI are installed:

```bash
node --version   # must be >= 22
supabase --version || npm install -g supabase
```

---

## Step 1 — Create the Supabase project

Use the Supabase Management API to create a new project under the human's org:

```bash
source .env.local

curl -s -X POST "https://api.supabase.com/v1/projects" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tokenmaxx",
    "organization_id": "'"$SUPABASE_ORG_ID"'",
    "plan": "free",
    "region": "us-east-1",
    "db_pass": "'"$(openssl rand -base64 24)"'"
  }' | tee /tmp/supabase-project.json
```

Extract the project ref and URL:

```bash
PROJECT_REF=$(cat /tmp/supabase-project.json | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
PROJECT_URL="https://${PROJECT_REF}.supabase.co"
```

Wait for the project to be ready (usually < 60 seconds):

```bash
until curl -sf "$PROJECT_URL/rest/v1/" -H "apikey: placeholder" | grep -q "Invalid"; do sleep 5; done
echo "Project ready: $PROJECT_URL"
```

Retrieve the project keys:

```bash
curl -s "https://api.supabase.com/v1/projects/$PROJECT_REF/api-keys" \
  -H "Authorization: Bearer $SUPABASE_PAT" | tee /tmp/supabase-keys.json
```

Append the project credentials to `.env.local`:

```bash
ANON_KEY=$(cat /tmp/supabase-keys.json | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const keys=JSON.parse(d);console.log(keys.find(k=>k.name==='anon').api_key)})")
SERVICE_ROLE_KEY=$(cat /tmp/supabase-keys.json | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const keys=JSON.parse(d);console.log(keys.find(k=>k.name==='service_role').api_key)})")

cat >> .env.local <<EOF

# Added by setup agent
NEXT_PUBLIC_SUPABASE_URL=$PROJECT_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_PROJECT_REF=$PROJECT_REF
EOF
```

Also create the capture config:

```bash
mkdir -p ~/.config/tokenmaxx
cat > ~/.config/tokenmaxx/.env <<EOF
SUPABASE_URL=$PROJECT_URL
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
TOKENMAXX_WORKSPACE_SLUG=default
TOKENMAXX_USER_SLUG=$(hostname)
EOF
chmod 600 ~/.config/tokenmaxx/.env
```

---

## Step 2 — Apply schema migrations

```bash
source .env.local

supabase link --project-ref $SUPABASE_PROJECT_REF
supabase db push
```

Verify the core tables exist:

```bash
supabase db execute --command "\dt" | grep -E "workspaces|users|usage_events|projects"
```

All four should appear. If any migration fails, read the error, fix the file, and re-run `supabase db push`.

---

## Step 3 — Seed config tables

Insert the initial workspace and user rows:

```bash
supabase db execute --command "
INSERT INTO workspaces (slug, display_name, timezone)
VALUES ('default', 'My Workspace', 'UTC')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (slug, display_name, account_type)
VALUES ('$(hostname)', '$(hostname)', 'service')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, u.id, 'admin'
FROM workspaces w, users u
WHERE w.slug = 'default' AND u.slug = '$(hostname)'
ON CONFLICT DO NOTHING;
"
```

---

## Step 4 — Configure local capture cron

Install dependencies and test the capture script once:

```bash
npm install
node scripts/local-capture.js --dry-run
```

If dry run succeeds, add the cron entry:

```bash
REPO_PATH=$(pwd)
NODE_BIN=$(which node)

(crontab -l 2>/dev/null; echo "0 5 * * * $NODE_BIN $REPO_PATH/scripts/local-capture.js >> ~/.config/tokenmaxx/logs/cron.log 2>&1") | crontab -
crontab -l | grep local-capture   # confirm it's there
```

---

## Step 5 — Deploy Edge Functions

```bash
supabase functions deploy toggl-sync
supabase functions deploy pricing-pull
supabase functions deploy fx-rate
supabase functions deploy daily-telegram
supabase functions deploy attribute-events
```

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env.local`, store them as Supabase secrets:

```bash
source .env.local
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  supabase secrets set TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID"
fi
```

---

## Step 6 — Deploy the dashboard to Cloudflare Pages

```bash
source .env.local

# Build
npm run build:cf

# Deploy (first time creates the project)
npx wrangler pages project create tokenmaxx --production-branch main 2>/dev/null || true
npx wrangler pages deploy .open-next/assets \
  --project-name tokenmaxx \
  --branch main

# Set env vars on Cloudflare Pages
npx wrangler pages project vars set \
  --project-name tokenmaxx \
  NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Capture the deploy URL from the output and note it for the human.

---

## Step 7 — Verify end-to-end

Insert a test event and confirm it appears in the dashboard:

```bash
supabase db execute --command "
INSERT INTO usage_events (
  workspace_id, user_id, captured_at, date_utc,
  provider, model, capture_method, aggregation_grain,
  input_tokens, output_tokens, token_share_pct
)
SELECT w.id, u.id, now(), current_date,
  'anthropic', 'claude-sonnet-4-6',
  'anthropic.claude_code.cli.personal_dev', 'session',
  1000, 500, 100.0
FROM workspaces w, users u
WHERE w.slug = 'default' AND u.slug = '$(hostname)';
"
```

Open the dashboard `/raw` page. The test event should appear within a few seconds. Then clean up:

```bash
supabase db execute --command "
DELETE FROM usage_events WHERE input_tokens = 1000 AND output_tokens = 500;
"
```

---

## Done — report back to the human

When all steps pass, report:

- Deploy URL (from Step 6)
- Any steps that needed manual intervention or produced errors
- Crontab entry installed (`crontab -l` output)

Checklist:
- [ ] Supabase project created — URL recorded in `.env.local`
- [ ] Schema migrations applied — all tables present
- [ ] Workspace and user rows seeded
- [ ] Local capture cron installed
- [ ] Edge Functions deployed
- [ ] Dashboard deployed at Cloudflare Pages URL
- [ ] Test event appeared in `/raw` feed
