# Deploying TokenMaxx to n9c-server in Docker (P8)

This is the actual playbook for migrating TokenMaxx off Cloudflare Workers
onto the private n9c-server Docker stack. Per OQ #6 the auth mechanism is
**Supabase Auth (email+password and magic link, both enabled)**. Downtime
during cutover is acceptable (Ben is the only user, OQ aware).

## Status — live on n9c-server as of 2026-06-01

✅ Container running: `docker compose ps` shows `tokenmaxx` Up (healthy) bound to
`127.0.0.1:3030`. Reads `/root/.config/tokenmaxx/web.env` for Supabase URL +
keys.
✅ Caddy site added at `/etc/caddy/Caddyfile` for `tokenmaxx-next.structlabs.io`
proxying to `127.0.0.1:3030`. Caddy reloaded.
🟡 DNS record for `tokenmaxx-next.structlabs.io` → `143.198.85.61` is **not yet
added** to Cloudflare. That's the only remaining manual step for the
parallel-run subdomain. Once added, Caddy auto-acquires the cert and the
container goes live on https.
🟡 Supabase Auth + RLS-aware queries not yet wired. The container currently runs
in the same no-auth mode as the Cloudflare Worker deploy. Auth is the next
step before the DNS flip on the real `tokenmaxx.structlabs.io`.

To finish the cutover when you're ready:
1. Add the DNS record (CF dashboard).
2. Wire `/auth/login`, middleware, RLS, all per the playbook below.
3. Flip the primary `tokenmaxx.structlabs.io` A record to `143.198.85.61`.
4. `npx wrangler delete --name tokenmaxx` once DNS propagates.

## Prerequisites on n9c-server

- Docker 24+ and docker-compose 2+
- Caddy 2.x (for auto-TLS at `tokenmaxx.structlabs.io`)
- DNS for `tokenmaxx.structlabs.io` pointed at `143.198.85.61`

## Build + ship the image

```bash
# Locally (or in CI):
docker build -t tokenmaxx:latest .
docker save tokenmaxx:latest | gzip | ssh root@143.198.85.61 'gunzip | docker load'

# Or build on the server directly:
ssh root@143.198.85.61 'cd /root/tokenmaxx && git pull && docker compose build'
```

## Environment

`/root/.config/tokenmaxx/web.env` (chmod 600):

```env
NEXT_PUBLIC_SUPABASE_URL=https://ewaknihwrzysakbtjzlx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # anon key (RLS-safe)
SUPABASE_SERVICE_ROLE_KEY=...        # only for the ingest paths
```

## Run

```bash
ssh root@143.198.85.61 'cd /root/tokenmaxx && docker compose up -d'
```

## Reverse proxy

Copy `Caddyfile` into `/etc/caddy/Caddyfile` (or include it). Reload:

```bash
ssh root@143.198.85.61 'caddy reload --config /etc/caddy/Caddyfile'
```

## DNS cutover

1. Run on a temporary subdomain first (e.g. `tokenmaxx-next.structlabs.io`)
   to validate auth + RLS.
2. When ready, change the `tokenmaxx.structlabs.io` A record from the
   Cloudflare Worker custom-domain endpoint to `143.198.85.61`.
3. Delete the Cloudflare Worker custom-domain mapping for tokenmaxx so
   Worker traffic dies cleanly.
4. Brief outage during DNS propagation is fine (single user).

## Auth — Supabase Auth setup

Before the cutover, in the Supabase project dashboard:
1. Enable email+password and magic-link in Authentication settings.
2. Whitelist `https://tokenmaxx.structlabs.io` as a redirect URL.
3. Set a Site URL of `https://tokenmaxx.structlabs.io`.
4. Add Ben's email as the single allowed user (or set up an email
   allowlist via a database trigger on `auth.users`).

Code changes (separate PR, before cutover):
- New `/auth/login` page with the Supabase Auth Web Component.
- Middleware that redirects unauthenticated requests to `/auth/login`.
- All RSC data fetches switch from `getSupabaseServerClient()` (service-role)
  to a per-request `createSupabaseServerClient()` (anon, reads cookies).
- RLS policies on every read-able table must allow the authenticated user
  to see their own workspace's rows.

## Decommissioning Cloudflare

```bash
# After DNS has cut over and the n9c container is serving:
cd ~/Projects/public/tokenmaxx
npx wrangler delete --name tokenmaxx
# Confirm and the Worker + its custom domain are gone.
```

## Rollback

If the n9c container has issues, point DNS back to the Cloudflare custom
domain endpoint and re-deploy the Worker:

```bash
cd ~/Projects/public/tokenmaxx
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN_N9C_GH_TO_TG npm run deploy
```

Single-user, downtime-OK constraint means manual revert is sufficient.
No need for automated rollback.
