#!/usr/bin/env node
/**
 * quota-tier1.js -- Code Meter widget-data.json -> Supabase quota_observations
 *
 * Reads the Claude Code Meter macOS widget file and records the current
 * quota state to the quota_observations table.
 *
 * MacBook-only. Exits 0 (non-fatal) if Code Meter file is not found.
 *
 * Usage:
 *   node quota-tier1.js
 *   node quota-tier1.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 *
 * Cron (every 15 min on MacBook, requires Code Meter running):
 *   see CRON_SETUP.md §Quota Tier 1
 */

'use strict';

const fs = require('fs');
const path = require('path');
const HOME = process.env.HOME || require('os').homedir();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Known Code Meter widget-data.json locations (first match wins)
const WIDGET_DATA_CANDIDATES = [
  path.join(
    HOME,
    'Library/Group Containers/group.com.streetcoding.claude-code-meter',
    'Library/Application Support/widget-data.json'
  ),
  path.join(
    HOME,
    'Library/Group Containers/group.com.streetcoding.claude-code-meter',
    'Library/Application Support/com.streetcoding.claude-code-meter/widget-data.json'
  ),
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

// --- Find widget-data.json ---

function findWidgetFile() {
  for (const candidate of WIDGET_DATA_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- Parse widget data ---

/**
 * widget-data.json structure (as observed):
 * {
 *   usageData: {
 *     dailyPercentUsed: 38,          // 5-hour window %
 *     dailyResetsAt: <CFAbsoluteTime>,
 *     dailyWindowLabel: "5-Hour Window",
 *     weeklyPercentUsed: 12,
 *     weeklyResetsAt: <CFAbsoluteTime>,
 *     weeklyWindowLabel: "Weekly",
 *     fetchedAt: <CFAbsoluteTime>
 *   },
 *   writtenAt: <CFAbsoluteTime>
 * }
 * Note: CFAbsoluteTime = seconds since 2001-01-01 00:00:00 UTC
 */

const CF_EPOCH_OFFSET_S = 978307200; // seconds between Unix epoch and CF epoch

function cfTimeToDate(cfTime) {
  if (!cfTime) return null;
  return new Date((cfTime + CF_EPOCH_OFFSET_S) * 1000);
}

function parseWidgetData(raw) {
  const usage = raw.usageData || {};
  const result = {};

  // 5-hour (daily) window
  if (typeof usage.dailyPercentUsed === 'number') {
    result.rolling5h = {
      percentUsed: usage.dailyPercentUsed,
      percentRemaining: 100 - usage.dailyPercentUsed,
      resetsAt: cfTimeToDate(usage.dailyResetsAt),
      windowLabel: usage.dailyWindowLabel || '5-Hour Window',
    };
  }

  // Weekly window
  if (typeof usage.weeklyPercentUsed === 'number') {
    result.weekly = {
      percentUsed: usage.weeklyPercentUsed,
      percentRemaining: 100 - usage.weeklyPercentUsed,
      resetsAt: cfTimeToDate(usage.weeklyResetsAt),
      windowLabel: usage.weeklyWindowLabel || 'Weekly',
    };
  }

  result.fetchedAt = cfTimeToDate(usage.fetchedAt);
  result.writtenAt = cfTimeToDate(raw.writtenAt);

  return result;
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

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
quota-tier1.js -- Code Meter widget-data.json -> Supabase quota_observations

Reads the macOS Code Meter widget file and records the current quota state.
MacBook-only. Non-fatal if file not found (Code Meter may not be running).

Usage:
  node quota-tier1.js
  node quota-tier1.js --dry-run

Options:
  --dry-run     Print what would be written, don't write
  --help, -h    Show this message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');

  // Find widget file
  const widgetFile = findWidgetFile();
  if (!widgetFile) {
    console.log('quota-tier1: widget-data.json not found — Code Meter may not be running. Exiting 0.');
    process.exit(0);
  }

  console.log(`quota-tier1: reading ${widgetFile}${dryRun ? ' [DRY RUN]' : ''}`);

  // Read + parse
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(widgetFile, 'utf8'));
  } catch (err) {
    console.error(`quota-tier1: failed to parse widget-data.json: ${err.message}`);
    process.exit(1);
  }

  const parsed = parseWidgetData(raw);
  console.log(`quota-tier1: fetchedAt=${parsed.fetchedAt?.toISOString() ?? 'unknown'}`);

  const observedAt = new Date().toISOString();

  // Insert observation for 5-hour rolling window
  if (parsed.rolling5h) {
    const { percentUsed, percentRemaining } = parsed.rolling5h;

    let windowRow;
    try {
      windowRow = await getQuotaWindowId('rolling_hours', 5);
    } catch (err) {
      console.error(`quota-tier1: ${err.message}`);
      process.exit(1);
    }

    const observation = {
      quota_window_id: windowRow.id,
      observed_at: observedAt,
      percent_used: percentUsed,
      percent_remaining: percentRemaining,
      source: 'tier1:code-meter-widget',
      observation_method: 'file-read',
      source_url: widgetFile,
      raw: raw,
    };

    console.log(
      `quota-tier1: 5h window (id=${windowRow.id}, "${windowRow.window_label}") — ${percentUsed}% used, ${percentRemaining}% remaining`
    );

    if (dryRun) {
      console.log('  [dry-run] would insert:', JSON.stringify(observation, null, 2));
    } else {
      await supabaseRequest('quota_observations', 'POST', observation, {
        Prefer: 'return=minimal',
      });
      console.log('  inserted quota_observation (5h rolling)');
    }
  } else {
    console.log('quota-tier1: no dailyPercentUsed in widget data — skipping 5h window');
  }

  // Insert observation for weekly window (if present)
  if (parsed.weekly) {
    const { percentUsed, percentRemaining } = parsed.weekly;

    let windowRow;
    try {
      windowRow = await getQuotaWindowId('calendar_week', null);
    } catch (err) {
      // Weekly window may not exist — non-fatal
      console.log(`quota-tier1: no calendar_week window found, skipping weekly: ${err.message}`);
      process.exit(0);
    }

    const observation = {
      quota_window_id: windowRow.id,
      observed_at: observedAt,
      percent_used: percentUsed,
      percent_remaining: percentRemaining,
      source: 'tier1:code-meter-widget',
      observation_method: 'file-read',
      source_url: widgetFile,
      raw: raw,
    };

    console.log(
      `quota-tier1: weekly window (id=${windowRow.id}, "${windowRow.window_label}") — ${percentUsed}% used, ${percentRemaining}% remaining`
    );

    if (dryRun) {
      console.log('  [dry-run] would insert:', JSON.stringify(observation, null, 2));
    } else {
      await supabaseRequest('quota_observations', 'POST', observation, {
        Prefer: 'return=minimal',
      });
      console.log('  inserted quota_observation (weekly)');
    }
  }

  console.log('\nquota-tier1: done');
}

main().catch(err => {
  console.error('quota-tier1 fatal error:', err.message);
  process.exit(1);
});
