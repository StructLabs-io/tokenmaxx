#!/usr/bin/env node
/**
 * quota-tier2.js -- claude.ai API (Brave session cookies) -> Supabase quota_observations
 *
 * Fetches quota data from the claude.ai usage report endpoint using session cookies
 * read directly from the Brave browser profile on disk (no browser needs to be open).
 * Falls back to CLAUDE_SESSION_KEY / CLAUDE_DEVICE_ID env vars if set.
 *
 * This accesses only the user's own account data via their own session.
 * Run responsibly — minimum 15-minute interval enforced by this script.
 *
 * NOTE: As of 2026-05-30, Cloudflare bot protection on claude.ai blocks all
 * non-browser HTTP clients (Node.js, curl) via JA3/JA4 TLS fingerprint matching,
 * even when cf_clearance and all valid session cookies are present.
 * This script reads all relevant cookies from Brave automatically (including cf_clearance),
 * but the TLS fingerprint mismatch still causes 403 responses. If Cloudflare protection
 * is removed or relaxed, this script will work as-is. For now, use quota-tier1.js
 * (Code Meter widget file) for Mac-local quota capture instead.
 *
 * Usage:
 *   node quota-tier2.js
 *   node quota-tier2.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL                  Required
 *   SUPABASE_SERVICE_ROLE_KEY     Required
 *   CLAUDE_ORG_ID                 Required — Anthropic org ID (visible in claude.ai URLs)
 *   BRAVE_PROFILE_PATH            Optional — override default Brave profile path
 *   CLAUDE_SESSION_KEY            Optional — manual override (skip Brave read)
 *   CLAUDE_DEVICE_ID              Optional — manual override
 *
 * See scripts/CRON_SETUP.md for cron setup instructions.
 */

'use strict';

const { getBraveCookies } = require('./brave-cookies.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAUDE_ORG_ID = process.env.CLAUDE_ORG_ID;

// Minimum interval between observations for the same window (minutes)
const MIN_INTERVAL_MINUTES = 10;

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

async function getQuotaWindowId(windowType, windowHours) {
  const filter = windowHours != null
    ? `window_type=eq.${encodeURIComponent(windowType)}&window_hours=eq.${windowHours}&active=eq.true&limit=1`
    : `window_type=eq.${encodeURIComponent(windowType)}&active=eq.true&limit=1`;
  const rows = await supabaseRequest(`quota_windows?select=id,window_label&${filter}`);
  if (!rows || rows.length === 0) {
    throw new Error(`No active quota_window found for type=${windowType} hours=${windowHours}`);
  }
  return rows[0];
}

// --- Rate-limit guard ---

async function getLastObservationAge(windowId) {
  const rows = await supabaseRequest(
    `quota_observations?select=observed_at&quota_window_id=eq.${windowId}&source=eq.tier2%3Aclaude-api&order=observed_at.desc&limit=1`
  );
  if (!rows || rows.length === 0) return Infinity;
  const lastMs = new Date(rows[0].observed_at).getTime();
  return (Date.now() - lastMs) / 60000; // minutes ago
}

// --- Resolve session cookies ---

/**
 * Get the cookies needed to authenticate to claude.ai.
 * Priority: env var overrides first, then Brave profile.
 *
 * @returns {Promise<{cookieString: string, source: string}>}
 */
async function resolveCookies() {
  const manualSessionKey = process.env.CLAUDE_SESSION_KEY;
  const manualDeviceId = process.env.CLAUDE_DEVICE_ID;

  // If both are supplied via env, use them directly (no Brave read needed)
  if (manualSessionKey) {
    let cookieString = `sessionKey=${manualSessionKey}`;
    if (manualDeviceId) cookieString += `; anthropic-device-id=${manualDeviceId}`;
    return { cookieString, source: 'env' };
  }

  // Read from Brave profile
  console.log('quota-tier2: reading cookies from Brave profile...');
  let cookies;
  try {
    cookies = await getBraveCookies('claude.ai', [
      'sessionKey',
      'cf_clearance',
      'anthropic-device-id',
      '__ssid',
    ]);
  } catch (err) {
    throw new Error(`Failed to read Brave cookies: ${err.message}`);
  }

  if (!cookies.sessionKey) {
    throw new Error(
      'sessionKey cookie not found in Brave profile for claude.ai.\n' +
      'Make sure you are logged into claude.ai in Brave.\n' +
      'Alternatively, set CLAUDE_SESSION_KEY env var as a manual override.'
    );
  }

  const parts = [];
  if (cookies.sessionKey) parts.push(`sessionKey=${cookies.sessionKey}`);
  if (cookies.cf_clearance) parts.push(`cf_clearance=${cookies.cf_clearance}`);
  if (manualDeviceId) {
    parts.push(`anthropic-device-id=${manualDeviceId}`);
  } else if (cookies['anthropic-device-id']) {
    parts.push(`anthropic-device-id=${cookies['anthropic-device-id']}`);
  }
  if (cookies.__ssid) parts.push(`__ssid=${cookies.__ssid}`);

  const found = Object.entries(cookies).filter(([, v]) => v).map(([k]) => k);
  console.log(`quota-tier2: found cookies from Brave: ${found.join(', ')}`);

  return { cookieString: parts.join('; '), source: 'brave' };
}

// --- Fetch claude.ai usage report ---

async function fetchClaudeUsage(orgId, cookieString) {
  const url = `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://claude.ai/',
      'anthropic-client-platform': 'web_claude_ai',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Auth failed (${res.status}) — session cookie may be expired or Cloudflare is blocking.\n` +
      'Log into claude.ai in Brave and try again. If the issue persists, check cf_clearance cookie.'
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`claude.ai API returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(
      `Unexpected content-type "${contentType}" — got HTML instead of JSON.\n` +
      `Cloudflare may be blocking the request. Try opening claude.ai in Brave first.\n` +
      `Response snippet: ${text.slice(0, 150)}`
    );
  }

  return res.json();
}

// --- Parse usage report ---

/**
 * Extract quota fields from the claude.ai /usage response.
 *
 * Confirmed response shape (2026-05-30):
 * {
 *   "five_hour":    { "utilization": 2,  "resets_at": "2026-05-30T05:40:00Z" },
 *   "seven_day":    { "utilization": 12, "resets_at": "2026-06-05T07:00:00Z" },
 *   "seven_day_sonnet": { ... },   // per-model breakdowns, may be null
 *   ...
 * }
 * utilization is an integer 0-100 (percent used).
 */
function extractWindowFields(windowData) {
  if (!windowData) return { percentUsed: null, percentRemaining: null };
  const pct = typeof windowData.utilization === 'number' ? windowData.utilization : null;
  return {
    percentUsed: pct,
    percentRemaining: pct != null ? 100 - pct : null,
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
quota-tier2.js -- claude.ai API (Brave session cookies) -> Supabase quota_observations

Fetches your Claude Code quota from claude.ai and records it to Supabase.
Reads cookies automatically from Brave browser profile on disk — no manual
cookie copy-paste needed. Falls back to CLAUDE_SESSION_KEY env var if set.

Usage:
  node quota-tier2.js
  node quota-tier2.js --dry-run

Options:
  --dry-run     Print what would be written, don't write
  --help, -h    Show this message

Required environment:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key
  CLAUDE_ORG_ID             Org ID from claude.ai URL

Optional environment (automatic if Brave profile is available):
  BRAVE_PROFILE_PATH        Override default Brave cookie DB path
  CLAUDE_SESSION_KEY        Manual sessionKey override (skips Brave read)
  CLAUDE_DEVICE_ID          Manual anthropic-device-id override
`);
    process.exit(0);
  }

  // Validate required env vars
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!CLAUDE_ORG_ID) missing.push('CLAUDE_ORG_ID');
  if (missing.length > 0) {
    console.error(`Error: missing required env vars: ${missing.join(', ')}`);
    console.error('Run with --help for setup instructions.');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const observedAt = new Date().toISOString();

  console.log(`quota-tier2: fetching claude.ai usage for org ${CLAUDE_ORG_ID}${dryRun ? ' [DRY RUN]' : ''}`);

  // Resolve cookies (Brave profile or env var)
  let cookieInfo;
  try {
    cookieInfo = await resolveCookies();
  } catch (err) {
    console.error(`quota-tier2: cookie resolution failed: ${err.message}`);
    process.exit(1);
  }
  console.log(`quota-tier2: using cookies from ${cookieInfo.source}`);

  // Fetch from claude.ai (single API call covers all windows)
  let rawData;
  try {
    rawData = await fetchClaudeUsage(CLAUDE_ORG_ID, cookieInfo.cookieString);
  } catch (err) {
    console.error(`quota-tier2: fetch failed: ${err.message}`);
    process.exit(1);
  }

  console.log('quota-tier2: raw response keys:', Object.keys(rawData).join(', '));

  // Windows to record: 5h rolling + 7-day calendar
  const windowDefs = [
    { windowType: 'rolling_hours', windowHours: 5,  responseKey: 'five_hour' },
    { windowType: 'calendar_week', windowHours: null, responseKey: 'seven_day' },
  ];

  for (const def of windowDefs) {
    let windowRow;
    try {
      windowRow = await getQuotaWindowId(def.windowType, def.windowHours);
    } catch (err) {
      console.warn(`quota-tier2: skipping ${def.windowType} — ${err.message}`);
      continue;
    }

    // Rate-limit guard per window
    if (!dryRun) {
      const minutesAgo = await getLastObservationAge(windowRow.id);
      if (minutesAgo < MIN_INTERVAL_MINUTES) {
        console.log(
          `quota-tier2: "${windowRow.window_label}" last observed ${minutesAgo.toFixed(1)} min ago — skipping`
        );
        continue;
      }
    }

    const windowData = rawData[def.responseKey];
    const fields = extractWindowFields(windowData);

    console.log(
      `quota-tier2: window "${windowRow.window_label}" (id=${windowRow.id}) — ` +
      `${fields.percentUsed ?? '?'}% used, resets ${windowData?.resets_at ?? 'unknown'}`
    );

    const observation = {
      quota_window_id: windowRow.id,
      observed_at: observedAt,
      percent_used: fields.percentUsed,
      percent_remaining: fields.percentRemaining,
      absolute_tokens_used: null,
      absolute_tokens_cap: null,
      cost_used_usd: null,
      cost_cap_usd: null,
      source: 'tier2:claude-api',
      observation_method: 'http-session-cookie',
      source_url: `https://claude.ai/api/organizations/${CLAUDE_ORG_ID}/usage`,
      raw: windowData ?? null,
    };

    if (dryRun) {
      console.log('[dry-run] would insert:', JSON.stringify(observation, null, 2));
    } else {
      await supabaseRequest('quota_observations', 'POST', observation, { Prefer: 'return=minimal' });
      console.log(`quota-tier2: inserted observation for "${windowRow.window_label}"`);
    }
  }

  console.log('\nquota-tier2: done');
}

main().catch(err => {
  console.error('quota-tier2 fatal error:', err.message);
  process.exit(1);
});
