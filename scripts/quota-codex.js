#!/usr/bin/env node
/**
 * quota-codex.js -- OpenAI Codex Pro quota -> Supabase quota_observations
 *
 * Reads cookies from Brave browser profile for platform.openai.com, then
 * attempts to discover and query the platform usage/limits endpoint.
 *
 * Non-fatal: if no authenticated session or no endpoint found, exits 0
 * with a clear log message. Suitable for cron.
 *
 * Usage:
 *   node quota-codex.js
 *   node quota-codex.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL                  Required
 *   SUPABASE_SERVICE_ROLE_KEY     Required
 *   BRAVE_PROFILE_PATH            Optional — override default Brave profile path
 *   OPENAI_SESSION_TOKEN          Optional — manual override (skip Brave read)
 *
 * See scripts/CRON_SETUP.md for cron setup instructions.
 */

'use strict';

const { getBraveCookies } = require('./brave-cookies.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Minimum interval between observations for the same window (minutes)
const MIN_INTERVAL_MINUTES = 10;

// OpenAI endpoints to probe (in order)
const CANDIDATE_ENDPOINTS = [
  {
    url: 'https://platform.openai.com/backend-api/usage',
    description: 'usage endpoint',
  },
  {
    url: 'https://platform.openai.com/backend-api/me',
    description: 'user/me endpoint',
  },
  {
    url: 'https://platform.openai.com/backend-api/dashboard/onboarding/billing_info',
    description: 'billing info endpoint',
  },
  {
    url: 'https://platform.openai.com/backend-api/billing/subscription',
    description: 'billing subscription endpoint',
  },
  {
    url: 'https://platform.openai.com/backend-api/usage_dashboard/operator/cumulative_costs',
    description: 'cumulative costs endpoint',
  },
];

// Supabase window IDs for Codex quota windows
// window_id=3 → Codex 5h rolling
// window_id=4 → Codex weekly
const CODEX_WINDOW_TYPE_5H = 'rolling_hours';
const CODEX_WINDOW_HOURS_5H = 5;
const CODEX_WINDOW_TYPE_WEEKLY = 'calendar_week';

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
  let filter;
  if (windowHours != null) {
    filter = `window_type=eq.${encodeURIComponent(windowType)}&window_hours=eq.${windowHours}&active=eq.true`;
  } else {
    filter = `window_type=eq.${encodeURIComponent(windowType)}&active=eq.true`;
  }
  if (windowLabel) {
    filter += `&window_label=eq.${encodeURIComponent(windowLabel)}`;
  }
  filter += '&limit=1';
  const rows = await supabaseRequest(`quota_windows?select=id,window_label&${filter}`);
  if (!rows || rows.length === 0) {
    return null; // Non-fatal — Codex windows may not be configured yet
  }
  return rows[0];
}

// --- Rate-limit guard ---

async function getLastObservationAge(windowId) {
  const rows = await supabaseRequest(
    `quota_observations?select=observed_at&quota_window_id=eq.${windowId}&source=eq.tier2%3Acodex-api&order=observed_at.desc&limit=1`
  );
  if (!rows || rows.length === 0) return Infinity;
  const lastMs = new Date(rows[0].observed_at).getTime();
  return (Date.now() - lastMs) / 60000;
}

// --- Resolve OpenAI cookies ---

/**
 * Get the best available cookie string for platform.openai.com.
 * @returns {Promise<{cookieString: string, source: string} | null>}
 */
async function resolveOpenAICookies() {
  const manualToken = process.env.OPENAI_SESSION_TOKEN;
  if (manualToken) {
    return {
      cookieString: `__Secure-next-auth.session-token=${manualToken}`,
      source: 'env',
    };
  }

  let cookies;
  try {
    // Try both the main domain and platform subdomain
    cookies = await getBraveCookies('openai.com', [
      '__Secure-next-auth.session-token',
      'cf_clearance',
      'oai-did',
      'oai-nav-state',
      'oai-sc',
      'oai-allow-ne2',
      '__Host-next-auth.csrf-token',
    ]);
  } catch (err) {
    console.warn(`quota-codex: could not read Brave cookies: ${err.message}`);
    return null;
  }

  // Check if we have any meaningful session cookie
  const sessionToken = cookies['__Secure-next-auth.session-token'];
  if (!sessionToken) {
    console.log('quota-codex: no OpenAI session token found in Brave profile');
    console.log('quota-codex: available cookies:', Object.keys(cookies).filter(k => cookies[k]).join(', ') || 'none');
    return null;
  }

  const parts = [];
  for (const [key, value] of Object.entries(cookies)) {
    if (value) parts.push(`${key}=${value}`);
  }

  const found = Object.entries(cookies).filter(([, v]) => v).map(([k]) => k);
  console.log(`quota-codex: found OpenAI cookies from Brave: ${found.join(', ')}`);

  return { cookieString: parts.join('; '), source: 'brave' };
}

// --- Probe OpenAI endpoints ---

/**
 * Try each candidate endpoint and return the first successful JSON response.
 * @param {string} cookieString
 * @returns {Promise<{url: string, data: object} | null>}
 */
async function probeOpenAIEndpoints(cookieString) {
  const headers = {
    'Cookie': cookieString,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://platform.openai.com/',
  };

  for (const endpoint of CANDIDATE_ENDPOINTS) {
    console.log(`quota-codex: probing ${endpoint.description} (${endpoint.url})`);
    try {
      const res = await fetch(endpoint.url, { method: 'GET', headers });
      const contentType = res.headers.get('content-type') || '';

      if (res.status === 401 || res.status === 403) {
        console.log(`quota-codex:   -> ${res.status} auth required`);
        continue;
      }
      if (res.status === 404) {
        console.log(`quota-codex:   -> 404 not found`);
        continue;
      }
      if (!res.ok) {
        console.log(`quota-codex:   -> ${res.status} error`);
        continue;
      }
      if (!contentType.includes('application/json')) {
        console.log(`quota-codex:   -> non-JSON response (${contentType}) — likely HTML/CF block`);
        continue;
      }

      const data = await res.json();
      console.log(`quota-codex:   -> OK, keys: ${Object.keys(data).slice(0, 8).join(', ')}`);
      return { url: endpoint.url, data };
    } catch (err) {
      console.log(`quota-codex:   -> fetch error: ${err.message}`);
    }
  }

  return null;
}

/**
 * Try to extract quota percentage from various OpenAI response shapes.
 * Returns null if the shape is unknown — log the raw for manual inspection.
 * @param {object} data
 * @returns {{ percentUsed: number|null, percentRemaining: number|null, raw: object }}
 */
function extractCodexQuota(data) {
  // Shape: { codex_limit: N, codex_used: N, ... }
  if (typeof data.codex_limit === 'number' && typeof data.codex_used === 'number') {
    const pct = Math.round((data.codex_used / data.codex_limit) * 100);
    return { percentUsed: pct, percentRemaining: 100 - pct, raw: data };
  }

  // Shape: { rate_limit: { codex: { remaining: N, limit: N } } }
  if (data.rate_limit?.codex) {
    const rl = data.rate_limit.codex;
    if (typeof rl.limit === 'number' && typeof rl.remaining === 'number') {
      const pct = Math.round(((rl.limit - rl.remaining) / rl.limit) * 100);
      return { percentUsed: pct, percentRemaining: 100 - pct, raw: data };
    }
  }

  // Shape: { usage: { codex: { ... } } }
  if (data.usage?.codex) {
    const u = data.usage.codex;
    if (typeof u.total === 'number' && typeof u.used === 'number') {
      const pct = Math.round((u.used / u.total) * 100);
      return { percentUsed: pct, percentRemaining: 100 - pct, raw: data };
    }
  }

  // Unknown shape — return raw for logging
  return { percentUsed: null, percentRemaining: null, raw: data };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
quota-codex.js -- OpenAI Codex Pro quota -> Supabase quota_observations

Reads cookies from Brave browser profile for openai.com, probes known
platform.openai.com endpoints for usage/quota data, and writes to Supabase.

Non-fatal: exits 0 if no authenticated session or no endpoint found.

Usage:
  node quota-codex.js
  node quota-codex.js --dry-run

Options:
  --dry-run     Print what would be written, don't write
  --help, -h    Show this message

Required environment:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Supabase service role key

Optional environment:
  BRAVE_PROFILE_PATH        Override default Brave cookie DB path
  OPENAI_SESSION_TOKEN      Manual __Secure-next-auth.session-token override
`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');

  console.log(`quota-codex: starting${dryRun ? ' [DRY RUN]' : ''}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('quota-codex: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Resolve OpenAI cookies
  const cookieInfo = await resolveOpenAICookies();
  if (!cookieInfo) {
    console.log('quota-codex: no OpenAI session available — endpoint not yet discovered');
    console.log('quota-codex: to set up, log into platform.openai.com in Brave and re-run');
    process.exit(0);
  }

  console.log(`quota-codex: using cookies from ${cookieInfo.source}`);

  // Probe endpoints
  const result = await probeOpenAIEndpoints(cookieInfo.cookieString);
  if (!result) {
    console.log('quota-codex: endpoint not yet discovered — no working endpoint found');
    console.log('quota-codex: this is non-fatal; check platform.openai.com manually to find the endpoint');
    process.exit(0);
  }

  console.log(`quota-codex: working endpoint: ${result.url}`);

  // Extract quota
  const quota = extractCodexQuota(result.data);
  if (quota.percentUsed === null) {
    console.log('quota-codex: response shape not yet mapped — raw data:');
    console.log(JSON.stringify(result.data, null, 2).slice(0, 1000));
    console.log('quota-codex: update extractCodexQuota() in this script to handle this shape');
    process.exit(0);
  }

  console.log(`quota-codex: ${quota.percentUsed}% used`);

  const observedAt = new Date().toISOString();

  // Write to both Codex quota windows if configured
  const windowDefs = [
    {
      windowType: CODEX_WINDOW_TYPE_5H,
      windowHours: CODEX_WINDOW_HOURS_5H,
      windowLabel: 'Codex 5h',
      description: 'Codex 5h rolling',
    },
    {
      windowType: CODEX_WINDOW_TYPE_WEEKLY,
      windowHours: null,
      windowLabel: 'Codex weekly',
      description: 'Codex weekly',
    },
  ];

  let wroteSomething = false;

  for (const def of windowDefs) {
    let windowRow;
    try {
      windowRow = await getQuotaWindowId(def.windowType, def.windowHours, def.windowLabel);
    } catch (err) {
      console.warn(`quota-codex: skipping ${def.description} — ${err.message}`);
      continue;
    }

    if (!windowRow) {
      console.log(`quota-codex: no quota_window configured for "${def.description}" — skipping`);
      console.log(`quota-codex: add a row to quota_windows with type=${def.windowType}, label=${def.windowLabel} to enable`);
      continue;
    }

    // Rate-limit guard
    if (!dryRun) {
      const minutesAgo = await getLastObservationAge(windowRow.id);
      if (minutesAgo < MIN_INTERVAL_MINUTES) {
        console.log(
          `quota-codex: "${windowRow.window_label}" last observed ${minutesAgo.toFixed(1)} min ago — skipping`
        );
        continue;
      }
    }

    const observation = {
      quota_window_id: windowRow.id,
      observed_at: observedAt,
      percent_used: quota.percentUsed,
      percent_remaining: quota.percentRemaining,
      absolute_tokens_used: null,
      absolute_tokens_cap: null,
      cost_used_usd: null,
      cost_cap_usd: null,
      source: 'tier2:codex-api',
      observation_method: 'http-session-cookie',
      source_url: result.url,
      raw: quota.raw,
    };

    if (dryRun) {
      console.log(`[dry-run] would insert for "${windowRow.window_label}":`, JSON.stringify(observation, null, 2));
    } else {
      await supabaseRequest('quota_observations', 'POST', observation, { Prefer: 'return=minimal' });
      console.log(`quota-codex: inserted observation for "${windowRow.window_label}"`);
    }
    wroteSomething = true;
  }

  if (!wroteSomething && !dryRun) {
    console.log('quota-codex: no Codex quota windows found in Supabase — nothing written');
    console.log('quota-codex: add Codex windows to quota_windows table to enable tracking');
  }

  console.log('\nquota-codex: done');
}

main().catch(err => {
  console.error('quota-codex fatal error:', err.message);
  process.exit(1);
});
