#!/usr/bin/env node
/**
 * quota-codex.js -- OpenAI Codex Pro quota -> Supabase quota_observations
 *
 * Fetches the "X% of monthly compute used" figure from chatgpt.com and writes
 * it to Supabase quota_observations for the Codex Pro quota windows.
 *
 * Target page:  https://chatgpt.com/codex/cloud/settings/analytics#usage
 * Auth domain:  chatgpt.com
 * Session key:  __Secure-next-auth.session-token (same cookie name used on
 *               chatgpt.com — different from platform.openai.com)
 *
 * Uses cycletls to spoof Chrome JA3/JA4 TLS fingerprint, bypassing Cloudflare
 * bot detection (same technique as quota-tier2.js for claude.ai).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ENDPOINT INVESTIGATION STATUS (2026-05-30)
 * ──────────────────────────────────────────────────────────────────────────────
 * Browser DevTools on chatgpt.com/codex/cloud/settings/analytics#usage found:
 *
 *   CONFIRMED (return daily task counts, NOT quota %):
 *     GET /backend-api/wham/analytics/daily-code-review-metrics
 *     GET /backend-api/wham/analytics/daily-skill-usage-metrics
 *     GET /backend-api/wham/analytics/daily-plugin-usage-metrics
 *     GET /backend-api/wham/analytics/daily-workspace-usage-counts
 *
 *   HYPOTHESIS (most likely source for "X% monthly compute"):
 *     GET /backend-api/wham/usage            <-- primary candidate
 *     GET /backend-api/wham/quota            <-- secondary candidate
 *     GET /backend-api/wham/compute          <-- tertiary candidate
 *     GET /backend-api/wham/subscription     <-- may include compute limits
 *     GET /backend-api/accounts/me           <-- may include compute_remaining
 *     GET /backend-api/subscription          <-- may include compute_quota
 *
 * The script probes all candidates in order, logs the response shape, and
 * calls extractCodexQuota() to parse the known shapes. If the response shape
 * is unknown, the raw JSON is printed so you can update extractCodexQuota().
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * FIRST-RUN SETUP
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. Log into chatgpt.com in Brave
 * 2. Set CHATGPT_SESSION_TOKEN in shared/.env (see §Getting your session token)
 * 3. Run: node scripts/quota-codex.js --dry-run
 * 4. Look at the "-> OK, keys:" log lines to identify the right endpoint
 * 5. If extractCodexQuota() returns percentUsed=null, update it (see below)
 *
 * §Getting your session token
 *   Open chatgpt.com in Brave -> DevTools -> Application -> Cookies ->
 *   Copy the value of __Secure-next-auth.session-token
 *   Set it as CHATGPT_SESSION_TOKEN in shared/.env
 *
 * Non-fatal: exits 0 if no session or no matching endpoint found. Cron-safe.
 *
 * Usage:
 *   node quota-codex.js
 *   node quota-codex.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL                  Required
 *   SUPABASE_SERVICE_ROLE_KEY     Required
 *   CHATGPT_SESSION_TOKEN         Required — __Secure-next-auth.session-token
 *                                  from chatgpt.com. Do NOT use Brave cookie
 *                                  reading (better-sqlite3 Node version conflict).
 *   OPENAI_SESSION_TOKEN          Alias for CHATGPT_SESSION_TOKEN (legacy compat)
 *
 * See scripts/CRON_SETUP.md for cron setup instructions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const HOME = process.env.HOME || os.homedir();

const initCycleTLS = require('cycletls');

// Chrome 124 JA3 fingerprint — same as quota-tier2.js (bypasses Cloudflare)
const CHROME_JA3 =
  '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,' +
  '0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Minimum interval between observations for the same window (minutes)
const MIN_INTERVAL_MINUTES = 10;

// chatgpt.com endpoints to probe (in priority order)
// Primary hypothesis: /wham/usage returns compute utilization %
const CANDIDATE_ENDPOINTS = [
  {
    url: 'https://chatgpt.com/backend-api/wham/usage',
    description: 'wham/usage (primary hypothesis)',
  },
  {
    url: 'https://chatgpt.com/backend-api/wham/quota',
    description: 'wham/quota',
  },
  {
    url: 'https://chatgpt.com/backend-api/wham/compute',
    description: 'wham/compute',
  },
  {
    url: 'https://chatgpt.com/backend-api/wham/subscription',
    description: 'wham/subscription',
  },
  {
    url: 'https://chatgpt.com/backend-api/wham',
    description: 'wham root',
  },
  {
    url: 'https://chatgpt.com/backend-api/accounts/me',
    description: 'accounts/me (may include compute_remaining)',
  },
  {
    url: 'https://chatgpt.com/backend-api/subscription',
    description: 'subscription (may include compute quota)',
  },
];

// Supabase window labels for Codex quota windows (must match quota_windows rows)
// window_label: 'Codex Pro — 5h rolling'  -> window_type: rolling_hours, window_hours: 5
// window_label: 'Codex Pro — weekly'       -> window_type: calendar_week
const CODEX_WINDOW_DEFS = [
  {
    windowType: 'rolling_hours',
    windowHours: 5,
    windowLabel: 'Codex Pro — 5h rolling',
    description: 'Codex Pro 5h rolling',
  },
  {
    windowType: 'calendar_week',
    windowHours: null,
    windowLabel: 'Codex Pro — weekly',
    description: 'Codex Pro weekly',
  },
];

// --- Supabase REST helper ---

async function supabaseRequest(urlPath, method = 'GET', body = null, extraHeaders = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${urlPath}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${urlPath}: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Look up quota_window_id ---

async function getQuotaWindowId(windowType, windowHours, windowLabel) {
  let filter = `window_type=eq.${encodeURIComponent(windowType)}&active=eq.true`;
  if (windowHours != null) {
    filter += `&window_hours=eq.${windowHours}`;
  }
  if (windowLabel) {
    filter += `&window_label=eq.${encodeURIComponent(windowLabel)}`;
  }
  filter += '&limit=1';
  const rows = await supabaseRequest(`quota_windows?select=id,window_label&${filter}`);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

// --- Rate-limit guard ---

async function getLastObservationAge(windowId) {
  const rows = await supabaseRequest(
    `quota_observations?select=observed_at&quota_window_id=eq.${windowId}` +
    `&source=eq.tier2%3Acodex-api&order=observed_at.desc&limit=1`
  );
  if (!rows || rows.length === 0) return Infinity;
  const lastMs = new Date(rows[0].observed_at).getTime();
  return (Date.now() - lastMs) / 60000;
}

// --- Resolve chatgpt.com session cookie ---

/**
 * Returns { cookieString, source } or null.
 *
 * chatgpt.com splits the session token across two chunked cookies:
 *   __Secure-next-auth.session-token.0  (large chunk)
 *   __Secure-next-auth.session-token.1  (tail chunk)
 *
 * Store both as CHATGPT_SESSION_TOKEN_0 and CHATGPT_SESSION_TOKEN_1 in shared/.env.
 * The server requires both cookies to reconstruct the session.
 *
 * Refresh these by running:
 *   python3 -c "
 *     from pycookiecheat import chrome_cookies; import os
 *     c = chrome_cookies('https://chatgpt.com', browser='Brave',
 *           cookie_file=os.path.expanduser(
 *             '~/Library/Application Support/BraveSoftware/Brave-Browser/Profile 1/Cookies'))
 *     print('TOKEN_0=' + c.get('__Secure-next-auth.session-token.0',''))
 *     print('TOKEN_1=' + c.get('__Secure-next-auth.session-token.1',''))
 *   "
 * then update CHATGPT_SESSION_TOKEN_0 / CHATGPT_SESSION_TOKEN_1 in shared/.env.
 */
function resolveSessionCookie() {
  const t0 = process.env.CHATGPT_SESSION_TOKEN_0;
  const t1 = process.env.CHATGPT_SESSION_TOKEN_1;
  if (t0 && t1) {
    return {
      cookieString:
        `__Secure-next-auth.session-token.0=${t0}; ` +
        `__Secure-next-auth.session-token.1=${t1}`,
      source: 'env (split tokens)',
    };
  }
  console.log(
    'quota-codex: missing CHATGPT_SESSION_TOKEN_0 / CHATGPT_SESSION_TOKEN_1.\n' +
    'Run the pycookiecheat snippet above and add both vars to shared/.env.'
  );
  return null;
}

// --- Fetch chatgpt.com wham/usage via two-step auth ---

/**
 * Auto-heal: invoke refresh-chatgpt-tokens.py to pull fresh tokens from Brave,
 * then re-source the env file. Returns true on success.
 *
 * Called automatically when fetchWhamUsage fails (likely expired session).
 * Replaces the manual "go refresh CHATGPT_SESSION_TOKEN_0/1" loop.
 */
function autoHealRefreshTokens() {
  const { execFileSync } = require('child_process');
  const refreshScript = path.join(__dirname, 'refresh-chatgpt-tokens.py');
  const envOut = process.env.CHATGPT_ENV_FILE || path.join(HOME, '.config', 'tokenmaxx', 'chatgpt.env');
  if (!fs.existsSync(refreshScript)) {
    console.log(`quota-codex: auto-heal — refresh script not found at ${refreshScript}`);
    return false;
  }
  try {
    const out = execFileSync('python3', [refreshScript, '--out', envOut], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`quota-codex: ${out.trim()}`);
  } catch (err) {
    console.log(`quota-codex: auto-heal failed: ${err.message}`);
    return false;
  }
  // Re-source the env file into process.env so resolveSessionCookie picks it up
  try {
    const contents = fs.readFileSync(envOut, 'utf8');
    for (const line of contents.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m) process.env[m[1]] = m[2];
    }
    return true;
  } catch (err) {
    console.log(`quota-codex: auto-heal env-reload failed: ${err.message}`);
    return false;
  }
}

/**
 * Step 1: Exchange session cookies for a short-lived Bearer (accessToken) via
 *         /api/auth/session (next-auth endpoint, returns JSON with .accessToken).
 * Step 2: Call /backend-api/wham/usage with Authorization: Bearer <accessToken>.
 *
 * Uses cycletls for Chrome JA3 TLS fingerprint spoof (bypasses Cloudflare).
 * Returns { url, data } on success, null on failure.
 */
async function fetchWhamUsage(cookieString, cycleTLS) {
  const baseHeaders = {
    Cookie: cookieString,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://chatgpt.com/codex/cloud/settings/analytics',
    'oai-language': 'en-US',
  };

  // Step 1: get accessToken
  console.log('quota-codex: fetching access token from /api/auth/session');
  let accessToken;
  try {
    const sessResp = await cycleTLS(
      'https://chatgpt.com/api/auth/session',
      { headers: baseHeaders, ja3: CHROME_JA3, userAgent: CHROME_UA },
      'get'
    );
    if (sessResp.status !== 200) {
      console.log(`quota-codex: /api/auth/session returned ${sessResp.status} — session likely expired`);
      return null;
    }
    const sessText = await sessResp.text();
    const sessData = JSON.parse(sessText);
    accessToken = sessData.accessToken;
    if (!accessToken) {
      console.log('quota-codex: /api/auth/session returned no accessToken — session expired?');
      return null;
    }
    console.log('quota-codex: got accessToken');
  } catch (err) {
    console.log(`quota-codex: /api/auth/session error: ${err.message}`);
    return null;
  }

  // Step 2: call wham/usage with Bearer
  const whamUrl = 'https://chatgpt.com/backend-api/wham/usage';
  console.log(`quota-codex: calling ${whamUrl}`);
  try {
    const whamResp = await cycleTLS(
      whamUrl,
      {
        headers: { ...baseHeaders, Authorization: `Bearer ${accessToken}` },
        ja3: CHROME_JA3,
        userAgent: CHROME_UA,
      },
      'get'
    );
    if (whamResp.status !== 200) {
      console.log(`quota-codex: wham/usage returned ${whamResp.status}`);
      return null;
    }
    const bodyText = await whamResp.text();
    const data = JSON.parse(bodyText);
    console.log(`quota-codex: wham/usage OK — plan_type=${data.plan_type ?? 'unknown'}`);
    return { url: whamUrl, data };
  } catch (err) {
    console.log(`quota-codex: wham/usage error: ${err.message}`);
    return null;
  }
}

/**
 * Parse the wham/usage response into per-window quota observations.
 *
 * Actual shape (confirmed 2026-05-31):
 *   {
 *     plan_type: 'prolite',
 *     rate_limit: {
 *       primary_window:   { used_percent: N, limit_window_seconds: 18000, reset_at: epoch },
 *       secondary_window: { used_percent: N, limit_window_seconds: 604800, reset_at: epoch },
 *     },
 *     additional_rate_limits: [
 *       { limit_name: 'GPT-5.3-Codex-Spark', rate_limit: { primary_window: {...}, secondary_window: {...} } },
 *     ],
 *   }
 *
 * Returns array of { windowDef, percentUsed, percentRemaining, raw }
 * where windowDef matches an entry in CODEX_WINDOW_DEFS.
 * Returns null if shape not recognized.
 */
function extractCodexQuota(data) {
  const rl = data.rate_limit;
  if (!rl || typeof rl.primary_window?.used_percent !== 'number') {
    // Unknown shape — log for debugging
    console.log(
      'quota-codex: unrecognized response shape. Raw (first 1000 chars):\n' +
      JSON.stringify(data).slice(0, 1000)
    );
    return null;
  }

  return [
    {
      windowDef: CODEX_WINDOW_DEFS.find((d) => d.windowType === 'rolling_hours'),
      percentUsed: Math.round(rl.primary_window.used_percent),
      percentRemaining: Math.round(100 - rl.primary_window.used_percent),
      resetAt: rl.primary_window.reset_at ? new Date(rl.primary_window.reset_at * 1000).toISOString() : null,
      raw: data,
    },
    {
      windowDef: CODEX_WINDOW_DEFS.find((d) => d.windowType === 'calendar_week'),
      percentUsed: Math.round(rl.secondary_window.used_percent),
      percentRemaining: Math.round(100 - rl.secondary_window.used_percent),
      resetAt: rl.secondary_window.reset_at ? new Date(rl.secondary_window.reset_at * 1000).toISOString() : null,
      raw: data,
    },
  ].filter((e) => e.windowDef != null);
}

// Legacy single-value extractor kept for reference — not called in main flow
function _extractCodexQuotaLegacy(data) {
  // Shape: { compute_utilization_pct: N }
  if (typeof data.compute_utilization_pct === 'number') {
    return {
      percentUsed: Math.round(data.compute_utilization_pct),
      percentRemaining: Math.round(100 - data.compute_utilization_pct),
      raw: data,
    };
  }

  // Shape: { utilization: N }  (matches claude.ai /usage shape)
  if (typeof data.utilization === 'number') {
    return {
      percentUsed: Math.round(data.utilization),
      percentRemaining: Math.round(100 - data.utilization),
      raw: data,
    };
  }

  // Shape: { compute: { utilization: N, ... } }
  if (typeof data.compute?.utilization === 'number') {
    const pct = data.compute.utilization;
    return { percentUsed: Math.round(pct), percentRemaining: Math.round(100 - pct), raw: data };
  }

  // Shape: { compute: { used: N, limit: N } }
  if (typeof data.compute?.used === 'number' && typeof data.compute?.limit === 'number') {
    const pct = (data.compute.used / data.compute.limit) * 100;
    return {
      percentUsed: Math.round(pct),
      percentRemaining: Math.round(100 - pct),
      raw: data,
    };
  }

  // Shape: { remaining_compute: N, total_compute: N }
  if (typeof data.remaining_compute === 'number' && typeof data.total_compute === 'number') {
    const used = data.total_compute - data.remaining_compute;
    const pct = (used / data.total_compute) * 100;
    return {
      percentUsed: Math.round(pct),
      percentRemaining: Math.round(100 - pct),
      raw: data,
    };
  }

  // Shape: { compute_used: N, compute_limit: N }
  if (typeof data.compute_used === 'number' && typeof data.compute_limit === 'number') {
    const pct = (data.compute_used / data.compute_limit) * 100;
    return {
      percentUsed: Math.round(pct),
      percentRemaining: Math.round(100 - pct),
      raw: data,
    };
  }

  // Shape: { quota: { used: N, limit: N } }
  if (typeof data.quota?.used === 'number' && typeof data.quota?.limit === 'number') {
    const pct = (data.quota.used / data.quota.limit) * 100;
    return {
      percentUsed: Math.round(pct),
      percentRemaining: Math.round(100 - pct),
      raw: data,
    };
  }

  // Shape: { wham_quota: { used: N, limit: N } }  or  { monthly: { ... } }
  if (typeof data.wham_quota?.used === 'number' && typeof data.wham_quota?.limit === 'number') {
    const pct = (data.wham_quota.used / data.wham_quota.limit) * 100;
    return {
      percentUsed: Math.round(pct),
      percentRemaining: Math.round(100 - pct),
      raw: data,
    };
  }

  // Unknown shape
  return { percentUsed: null, percentRemaining: null, raw: data };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
quota-codex.js -- OpenAI Codex Pro quota -> Supabase quota_observations

Fetches the monthly compute utilization % from chatgpt.com and records it
to Supabase. Probes multiple /backend-api/wham/* endpoints to find the one
that returns "X% of monthly compute used".

Non-fatal: exits 0 if no session or no endpoint found. Safe for cron.

Usage:
  node quota-codex.js
  node quota-codex.js --dry-run

Options:
  --dry-run     Print what would be written, don't write
  --help, -h    Show this message

Required environment:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key
  CHATGPT_SESSION_TOKEN     __Secure-next-auth.session-token from chatgpt.com
                            (copy from Brave DevTools -> Application -> Cookies)

Optional environment:
  OPENAI_SESSION_TOKEN      Alias for CHATGPT_SESSION_TOKEN (legacy compat)
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  console.log(`quota-codex: starting${dryRun ? ' [DRY RUN]' : ''}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('quota-codex: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Resolve session cookie
  const cookieInfo = resolveSessionCookie();
  if (!cookieInfo) {
    // resolveSessionCookie() already logged the instructions
    process.exit(0);
  }
  console.log(`quota-codex: using session from ${cookieInfo.source}`);

  // Init CycleTLS (Chrome TLS fingerprint spoof — bypasses Cloudflare)
  const cycleTLS = await initCycleTLS();

  // Fetch wham/usage (two-step: session → Bearer → wham/usage)
  let result;
  try {
    result = await fetchWhamUsage(cookieInfo.cookieString, cycleTLS);

    // Auto-heal: if the first fetch failed, try refreshing the ChatGPT
    // session tokens from Brave and retry once. Avoids the silent stale
    // state that triggered the dashboard's stale-Codex banner.
    if (!result) {
      console.log('quota-codex: auto-healing — running refresh-chatgpt-tokens.py…');
      const refreshed = autoHealRefreshTokens();
      if (refreshed) {
        const newCookieInfo = resolveSessionCookie();
        if (newCookieInfo) {
          console.log(`quota-codex: retrying with refreshed session (${newCookieInfo.source})`);
          result = await fetchWhamUsage(newCookieInfo.cookieString, cycleTLS);
        }
      }
    }
  } finally {
    await cycleTLS.exit();
  }

  if (!result) {
    console.log(
      'quota-codex: still no wham/usage after auto-heal. Brave may not be logged in to chatgpt.com.\n' +
      'Open Brave (Profile 1) and sign in, then re-run.'
    );
    process.exit(0);
  }

  // Parse per-window quota values from the response
  const quotaEntries = extractCodexQuota(result.data);
  if (!quotaEntries) {
    process.exit(0); // extractCodexQuota already logged the raw response
  }

  const observedAt = new Date().toISOString();
  let wroteSomething = false;

  for (const entry of quotaEntries) {
    const { windowDef, percentUsed, percentRemaining } = entry;
    console.log(`quota-codex: ${windowDef.description}: ${percentUsed}% used (${percentRemaining}% remaining)`);

    let windowRow;
    try {
      windowRow = await getQuotaWindowId(windowDef.windowType, windowDef.windowHours, windowDef.windowLabel);
    } catch (err) {
      console.warn(`quota-codex: skipping ${windowDef.description} — lookup error: ${err.message}`);
      continue;
    }

    if (!windowRow) {
      console.log(
        `quota-codex: no quota_window configured for "${windowDef.windowLabel}" — skipping\n` +
        `quota-codex: add a row to quota_windows: type=${windowDef.windowType}, ` +
        `label="${windowDef.windowLabel}" to enable`
      );
      continue;
    }

    // Rate-limit guard
    if (!dryRun) {
      const minutesAgo = await getLastObservationAge(windowRow.id);
      if (minutesAgo < MIN_INTERVAL_MINUTES) {
        console.log(
          `quota-codex: "${windowRow.window_label}" last observed ` +
          `${minutesAgo.toFixed(1)} min ago — skipping (min interval: ${MIN_INTERVAL_MINUTES} min)`
        );
        continue;
      }
    }

    const observation = {
      quota_window_id: windowRow.id,
      observed_at: observedAt,
      percent_used: percentUsed,
      percent_remaining: percentRemaining,
      absolute_tokens_used: null,
      absolute_tokens_cap: null,
      cost_used_usd: null,
      cost_cap_usd: null,
      source: 'tier2:codex-api',
      observation_method: 'http-session-cookie',
      source_url: result.url,
      raw: entry.raw,
    };

    if (dryRun) {
      console.log(
        `[dry-run] would insert for "${windowRow.window_label}":\n` +
        JSON.stringify(observation, null, 2)
      );
    } else {
      await supabaseRequest('quota_observations', 'POST', observation, {
        Prefer: 'return=minimal',
      });
      console.log(`quota-codex: inserted observation for "${windowRow.window_label}"`);
    }
    wroteSomething = true;
  }

  if (!wroteSomething && !dryRun) {
    console.log(
      'quota-codex: no Codex quota windows found in Supabase — nothing written.\n' +
      'Add Codex windows to quota_windows table:\n' +
      '  label="Codex Pro — 5h rolling", type=rolling_hours, window_hours=5\n' +
      '  label="Codex Pro — weekly",     type=calendar_week'
    );
  }

  console.log('\nquota-codex: done');
}

main().catch(err => {
  console.error('quota-codex fatal error:', err.message);
  process.exit(1);
});
