#!/usr/bin/env node
/**
 * quota-tier2.js -- claude.ai API (session cookie) -> Supabase quota_observations
 *
 * Fetches quota data from the claude.ai usage report endpoint using a
 * user-supplied session cookie and writes to quota_observations.
 *
 * This accesses only the user's own account data via their own session.
 * Run responsibly — minimum 15-minute interval enforced by this script.
 *
 * Usage:
 *   node quota-tier2.js
 *   node quota-tier2.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 *   CLAUDE_ORG_ID             Required — Anthropic org ID (visible in claude.ai URLs)
 *   CLAUDE_SESSION_KEY        Required — value of the sessionKey cookie from claude.ai
 *
 * See .env.example for setup instructions.
 */

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAUDE_ORG_ID = process.env.CLAUDE_ORG_ID;
const CLAUDE_SESSION_KEY = process.env.CLAUDE_SESSION_KEY;

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

// --- Fetch claude.ai usage report ---

async function fetchClaudeUsage(orgId, sessionKey) {
  const url = `https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage_report/claude_code`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': `sessionKey=${sessionKey}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://claude.ai/',
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Auth failed (${res.status}) — CLAUDE_SESSION_KEY may be expired. ` +
      'Log into claude.ai, open DevTools > Application > Cookies, copy sessionKey value.'
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
      `Unexpected content-type "${contentType}" — got HTML instead of JSON. ` +
      `Session cookie may be invalid. Response snippet: ${text.slice(0, 150)}`
    );
  }

  return res.json();
}

// --- Parse usage report ---

/**
 * Extract quota fields from the claude.ai usage_report response.
 * The exact schema may change — we extract defensively.
 *
 * Known response shape (as of 2026-05):
 * {
 *   "usage": {
 *     "tokens_used": 123456,
 *     "tokens_limit": 500000,
 *     "percent_used": 24.69,
 *     "window_type": "rolling_5h",   // or similar
 *     "reset_at": "2026-05-30T12:00:00Z"
 *   }
 * }
 *
 * The response structure is undocumented. We try multiple paths.
 */
function extractQuotaFields(data) {
  // Try top-level or nested under "usage"
  const u = data?.usage || data || {};

  const percentUsed =
    typeof u.percent_used === 'number' ? u.percent_used :
    (u.tokens_limit && u.tokens_used)
      ? Math.round((u.tokens_used / u.tokens_limit) * 10000) / 100
      : null;

  const percentRemaining =
    percentUsed != null ? Math.round((100 - percentUsed) * 100) / 100 : null;

  return {
    percentUsed,
    percentRemaining,
    absoluteTokensUsed: typeof u.tokens_used === 'number' ? u.tokens_used : null,
    absoluteTokensCap: typeof u.tokens_limit === 'number' ? u.tokens_limit : null,
    costUsedUsd: typeof u.cost_used_usd === 'number' ? u.cost_used_usd : null,
    costCapUsd: typeof u.cost_cap_usd === 'number' ? u.cost_cap_usd : null,
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
quota-tier2.js -- claude.ai API (session cookie) -> Supabase quota_observations

Fetches your Claude Code quota from claude.ai and records it to Supabase.
Uses your own session cookie — accesses only your own account data.
Minimum 15-minute cron interval. Script self-rate-limits at 10 min.

Usage:
  node quota-tier2.js
  node quota-tier2.js --dry-run

Options:
  --dry-run     Print what would be written, don't write
  --help, -h    Show this message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
  CLAUDE_ORG_ID             Required — org ID from claude.ai URL
  CLAUDE_SESSION_KEY        Required — sessionKey cookie value from claude.ai

How to get CLAUDE_SESSION_KEY:
  1. Open claude.ai in browser, log in
  2. Open DevTools (F12) > Application > Cookies > claude.ai
  3. Copy the value of the "sessionKey" cookie
  4. Add to your .env: CLAUDE_SESSION_KEY=<value>
  Session keys expire — re-copy when you see 401 errors.
`);
    process.exit(0);
  }

  // Validate required env vars
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!CLAUDE_ORG_ID) missing.push('CLAUDE_ORG_ID');
  if (!CLAUDE_SESSION_KEY) missing.push('CLAUDE_SESSION_KEY');
  if (missing.length > 0) {
    console.error(`Error: missing required env vars: ${missing.join(', ')}`);
    console.error('Run with --help for setup instructions.');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const observedAt = new Date().toISOString();

  console.log(`quota-tier2: fetching claude.ai usage for org ${CLAUDE_ORG_ID}${dryRun ? ' [DRY RUN]' : ''}`);

  // Look up the 5h rolling window
  let windowRow;
  try {
    windowRow = await getQuotaWindowId('rolling_hours', 5);
  } catch (err) {
    console.error(`quota-tier2: ${err.message}`);
    process.exit(1);
  }

  // Rate-limit guard
  if (!dryRun) {
    const minutesAgo = await getLastObservationAge(windowRow.id);
    if (minutesAgo < MIN_INTERVAL_MINUTES) {
      console.log(
        `quota-tier2: last tier2 observation was ${minutesAgo.toFixed(1)} min ago ` +
        `(< ${MIN_INTERVAL_MINUTES} min minimum) — skipping`
      );
      process.exit(0);
    }
  }

  // Fetch from claude.ai
  let rawData;
  try {
    rawData = await fetchClaudeUsage(CLAUDE_ORG_ID, CLAUDE_SESSION_KEY);
  } catch (err) {
    console.error(`quota-tier2: fetch failed: ${err.message}`);
    process.exit(1);
  }

  console.log('quota-tier2: raw response keys:', Object.keys(rawData).join(', '));

  const fields = extractQuotaFields(rawData);

  if (fields.percentUsed == null && fields.absoluteTokensUsed == null) {
    console.warn(
      'quota-tier2: could not extract percent_used or absolute_tokens_used from response. ' +
      'API response structure may have changed. Raw:', JSON.stringify(rawData).slice(0, 300)
    );
    // Still insert with null fields so we have a record of the raw response
  }

  console.log(
    `quota-tier2: window "${windowRow.window_label}" (id=${windowRow.id}) — ` +
    `${fields.percentUsed ?? '?'}% used, ${fields.absoluteTokensUsed ?? '?'} tokens`
  );

  const observation = {
    quota_window_id: windowRow.id,
    observed_at: observedAt,
    percent_used: fields.percentUsed,
    percent_remaining: fields.percentRemaining,
    absolute_tokens_used: fields.absoluteTokensUsed,
    absolute_tokens_cap: fields.absoluteTokensCap,
    cost_used_usd: fields.costUsedUsd,
    cost_cap_usd: fields.costCapUsd,
    source: 'tier2:claude-api',
    observation_method: 'http-session-cookie',
    source_url: `https://claude.ai/api/organizations/${CLAUDE_ORG_ID}/usage_report/claude_code`,
    raw: rawData,
  };

  if (dryRun) {
    console.log('[dry-run] would insert:', JSON.stringify(observation, null, 2));
  } else {
    await supabaseRequest('quota_observations', 'POST', observation, {
      Prefer: 'return=minimal',
    });
    console.log('quota-tier2: inserted quota_observation');
  }

  console.log('\nquota-tier2: done');
}

main().catch(err => {
  console.error('quota-tier2 fatal error:', err.message);
  process.exit(1);
});
