# Setup — What You (the Human) Must Do

**Version:** v0.1
**Status:** Draft — pending Ben's review
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.1 | 2026-05-29 | An AI agent | Initial human setup guide |

---

These are the steps only you can take. They require a browser, account sign-ups, and human judgment. Once you've done them, hand off to your AI agent with [SETUP-AGENT.md](SETUP-AGENT.md).

---

## Prerequisites

- A machine running Claude Code and/or Codex CLI (where your AI usage actually happens)
- A GitHub account (for Cloudflare Pages auto-deploy)
- A Toggl account (optional — needed for project attribution)
- A Telegram bot and chat (optional — needed for daily digest)

---

## Step 1 — Fork or clone this repo

Fork `tokenmaxx` on GitHub (or clone it privately if you want to keep your config out of the public repo).

```bash
git clone https://github.com/<your-org>/tokenmaxx.git
cd tokenmaxx
```

Keep your `.env` files out of git (they're already in `.gitignore`).

---

## Step 2 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free account works for solo use)
2. Create a new project:
   - **Name:** `tokenmaxx` (or your team name)
   - **Database password:** generate a strong one and save it in your password manager
   - **Region:** pick the region closest to where your capture scripts run
3. Wait for the project to provision (~60 seconds)
4. Go to **Project Settings → API** and copy:
   - `Project URL` (looks like `https://abcdefghij.supabase.co`)
   - `anon` / `public` key
   - `service_role` key (secret — never expose this in a browser)

> **Supabase free tier:** 500 MB database, project pauses after 7 days inactivity. For daily use, upgrade to Pro ($25/mo) to avoid pausing. Your AI agent can't wake a paused Supabase project.

---

## Step 3 — Create a Cloudflare Pages project

1. Go to [cloudflare.com](https://cloudflare.com) and sign up or log in
2. Navigate to **Pages → Create a project → Connect to Git**
3. Select your forked/cloned `tokenmaxx` repo
4. Configure build settings:
   - **Framework preset:** Next.js
   - **Build command:** `npx @cloudflare/next-on-pages`
   - **Build output directory:** `.vercel/output/static`
   - **Node version:** 20 or later (set in Environment Variables: `NODE_VERSION = 20`)
5. Click **Save and Deploy** — the first deploy will fail until you add environment variables (next step)

---

## Step 4 — Add environment variables to Cloudflare Pages

In your Cloudflare Pages project → **Settings → Environment variables**, add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | From Step 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key | From Step 2 |

> Do not add the `service_role` key to Pages environment variables. It never goes to the browser.

Redeploy the project after adding these variables.

---

## Step 5 — Create your `.env` files for capture scripts

On each machine where you run Claude Code or Codex CLI, create:

```
~/.config/tokenmaxx/.env
```

With these values (your agent can help you fill this in):

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
TOKENMAXX_WORKSPACE_SLUG=<your-workspace-name>
TOKENMAXX_USER_SLUG=<your-machine-name>   # e.g. "my-macbook" or "home-server"

# Optional — Toggl
TOGGL_API_TOKEN=<your-toggl-pat>

# Optional — for quota capture (v1.0)
# CLAUDE_SESSION_COOKIE=<your-claude.ai-session-cookie>
```

Set permissions: `chmod 600 ~/.config/tokenmaxx/.env`

---

## Step 6 — Optional: set up Telegram digest

If you want a daily Telegram summary:

1. Chat with [@BotFather](https://t.me/BotFather) on Telegram → create a new bot → copy the bot token
2. Add the bot to a Telegram group or channel, or use your personal chat
3. Get the chat ID (ask the bot `/start`, then visit `https://api.telegram.org/bot<token>/getUpdates`)
4. In Supabase → **Vault** (or Project Settings → Vault), create two secrets:
   - `TELEGRAM_BOT_TOKEN` = your bot token
   - `TELEGRAM_CHAT_ID` = your chat/group ID

Your agent will configure the digest schedule once secrets are in place.

---

## Step 7 — Hand off to your AI agent

You've done the human-only steps. Now give your AI agent this checklist and tell it to follow [SETUP-AGENT.md](SETUP-AGENT.md):

- [x] Supabase project created — URL and keys saved to `.env`
- [x] Cloudflare Pages project created and connected to repo
- [x] Environment variables added to Pages
- [x] `.env` files created on capture machines
- [ ] Schema migrations applied (agent does this)
- [ ] Cron configured (agent does this)
- [ ] End-to-end test (agent does this)

---

## Troubleshooting common issues

**Supabase project is paused**
Free-tier projects pause after 7 days of inactivity. Visit your Supabase dashboard to unpause. Upgrade to Pro to avoid this.

**Cloudflare Pages build fails**
Check the build log for missing environment variables or Node.js version issues. Ensure `NODE_VERSION = 20` is set.

**Service role key exposed in git**
If you accidentally commit a `.env` file, rotate the service role key immediately in Supabase → Settings → API → Rotate.

**No data appearing in dashboard**
Run a capture script manually once (`node scripts/local-capture.js`) and check for errors. Verify your `.env` is readable and Supabase is awake.
