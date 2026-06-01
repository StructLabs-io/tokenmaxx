# Setup — What You (the Human) Must Do

**Version:** v0.2
**Status:** Approved (v0.1)
**Last updated:** 2026-05-29

## Changelog

| Version | Date | Author | Changes |
|---|---|---|---|
| v0.2 | 2026-05-29 | Kenji Ryu | Rewritten to thin human-only steps; agent does the rest |
| v0.1 | 2026-05-29 | Human Approved | Initial human setup guide |

---

Your AI agent handles almost all of the setup. You only need to do the parts that require a browser, account sign-ups, and decisions only you can make.

**Estimated time: ~5 minutes.**

---

## Step 1 — Sign up for Supabase

Go to [supabase.com](https://supabase.com) and create a free account if you don't have one.

No project needed yet — your agent will create that.

---

## Step 2 — Generate a Supabase Personal Access Token

1. Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Click **Generate new token**
3. Name it `tokenmaxx`
4. Copy the token — you won't see it again

---

## Step 3 — Sign up for Cloudflare

Go to [cloudflare.com](https://cloudflare.com) and create a free account if you don't have one.

---

## Step 4 — Generate a Cloudflare API token

1. Go to **My Profile → API Tokens → Create Token**
2. Use the **Edit Cloudflare Workers** template (covers Workers and Pages)
3. Copy the token

---

## Step 5 — Put secrets in `.env.local`

Clone the repo, then create `.env.local` at the repo root:

```bash
git clone https://github.com/<your-org>/tokenmaxx.git
cd tokenmaxx
cp .env.example .env.local
```

Fill in your values:

```bash
# Supabase (from Steps 1–2)
SUPABASE_PAT=<your-supabase-personal-access-token>
SUPABASE_ORG_ID=<your-org-id>          # visible in the Supabase dashboard URL

# Cloudflare (from Steps 3–4)
CLOUDFLARE_API_TOKEN=<your-cloudflare-api-token>
CLOUDFLARE_ACCOUNT_ID=<your-account-id>   # visible in your Cloudflare dashboard sidebar

# Optional — Telegram digest (see Step 6)
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
```

Your org ID and account ID are visible in the URL bar of each dashboard after you sign in.

---

## Step 6 — Optional: set up Telegram digest

If you want a daily summary of your AI usage in Telegram:

1. Chat with [@BotFather](https://t.me/BotFather) on Telegram — create a new bot — copy the bot token
2. Add the bot to a group or use your personal chat
3. Get the chat ID (send `/start` to the bot, then visit `https://api.telegram.org/bot<token>/getUpdates`)
4. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env.local`

Your agent will configure the rest.

---

## Step 7 — Hand off to your AI agent

You're done. Tell your agent:

> "Set up TokenMaxx. Follow `docs/SETUP-AGENT.md`. My `.env.local` is ready."

Your agent will provision the Supabase project, apply the schema, configure capture cron, deploy the dashboard, and report back the URL.

---

## Troubleshooting

**Supabase free tier pauses after 7 days of inactivity.** Visit your Supabase dashboard to unpause. Upgrade to Pro ($25/mo) if you're using this daily.

**Cloudflare token permissions.** If the agent hits a 403 on Pages, check that your token includes `Cloudflare Pages: Edit` scope in addition to Workers.
