#!/usr/bin/env node
/**
 * server-capture.js -- OpenClaw server JSONL usage -> Supabase usage_events
 *
 * Reads OpenClaw cron run JSONL files (server-side) and writes per-event
 * rows to Supabase usage_events. Also sweeps Codex CLI session JSONL files
 * for incremental capture.
 *
 * capture_method format: <provider>.<tool>.<surface>.<context>
 *   e.g. anthropic.ccusage.cli.personal_dev
 *        openai-codex.ccusage.cli.openclaw
 *        google.ccusage.cli.openclaw
 *
 * Usage:
 *   node server-capture.js
 *   node server-capture.js --date 2026-05-29
 *   node server-capture.js --backfill 2026-05-01
 *   node server-capture.js --dry-run
 *   node server-capture.js --user-slug openclaw-server
 *
 * Options:
 *   --date YYYY-MM-DD            Process a specific date (default: yesterday UTC)
 *   --backfill YYYY-MM-DD        Process all dates from this date to yesterday
 *   --dry-run                    Print what would be written, don't write to Supabase
 *   --user-slug <slug>           User identifier (default: openclaw-server)
 *   --workspace-id <uuid>        Workspace UUID (overrides TOKENMAXX_WORKSPACE_ID env)
 *   --skip-codex                 Skip Codex CLI session sweep
 *   --help, -h                   Show this message
 *
 * Environment:
 *   SUPABASE_URL                 Required
 *   SUPABASE_SERVICE_ROLE_KEY    Required
 *   TOKENMAXX_WORKSPACE_ID       Required (or pass --workspace-id)
 *   TOKENMAXX_USER_SLUG          Default user slug (overridden by --user-slug)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRON_RUNS_DIR = '/home/openclaw/.openclaw/cron/runs';
let CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || '/home/openclaw/.codex/sessions';
let STATE_FILE = process.env.TOKENMAXX_SERVER_STATE_FILE || '/home/openclaw/.config/tokenmaxx/server-state.json';

// Maps provider field (from JSONL) -> capture method provider segment
const PROVIDER_MAP = {
  'anthropic':    'anthropic',
  'openai':       'openai-codex',
  'openai-codex': 'openai-codex',
  'google':       'google',
  'openrouter':   'openrouter',
};

function captureMethodForProvider(provider, surface = 'cli', context = 'openclaw') {
  const p = PROVIDER_MAP[provider] || provider;
  return `${p}.ccusage.${surface}.${context}`;
}

// --- Supabase REST helper ---

async function supabaseRequest(path_, method = 'GET', body = null, extraHeaders = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path_}`;
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
    throw new Error(`Supabase ${method} ${path_}: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getUserId(slug) {
  const rows = await supabaseRequest(`users?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!rows || rows.length === 0) throw new Error(`User with slug "${slug}" not found in Supabase`);
  return rows[0].id;
}

async function getWorkspaceId(idOrSlug) {
  // If it's a UUID, use directly
  if (/^[0-9a-f-]{36}$/i.test(idOrSlug)) return idOrSlug;
  const rows = await supabaseRequest(`workspaces?select=id&slug=eq.${encodeURIComponent(idOrSlug)}&limit=1`);
  if (!rows || rows.length === 0) throw new Error(`Workspace "${idOrSlug}" not found`);
  return rows[0].id;
}

async function batchInsertEvents(rows, dryRun) {
  if (rows.length === 0) return { inserted: 0, failed: 0 };
  if (dryRun) {
    for (const row of rows) {
      console.log(`    [dry-run] ${row.provider}/${row.model} ${row.date_utc} in:${row.input_tokens} out:${row.output_tokens}`);
    }
    return { inserted: rows.length, failed: 0 };
  }
  const BATCH = 100;
  let inserted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    try {
      await supabaseRequest('usage_events', 'POST', chunk, {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      inserted += chunk.length;
    } catch (err) {
      console.error(`    FAIL batch (${chunk.length} rows): ${err.message}`);
      failed += chunk.length;
    }
  }
  return { inserted, failed };
}

// --- Token extraction helpers ---

function firstNumeric(...values) {
  for (const v of values) {
    if (Number.isFinite(v)) return v;
  }
  return 0;
}

function cacheCreationTokens(usage) {
  return firstNumeric(
    usage.cache_creation_input_tokens,
    usage.cache_creation_tokens,
    usage.prompt_cache_creation_tokens,
    usage.input_token_details && usage.input_token_details.cache_creation_tokens
  );
}

function cacheReadTokens(usage) {
  return firstNumeric(
    usage.cache_read_input_tokens,
    usage.cache_read_tokens,
    usage.prompt_cache_read_tokens,
    usage.cached_tokens,
    usage.cached_input_tokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens,
    usage.input_token_details && usage.input_token_details.cached_tokens,
    usage.input_tokens_details && usage.input_tokens_details.cached_tokens
  );
}

// --- Cron JSONL reader ---

function readCronEventsForDate(targetDate) {
  const dayStart = new Date(targetDate + 'T00:00:00Z').getTime();
  const dayEnd   = new Date(targetDate + 'T23:59:59.999Z').getTime();
  const events = [];

  if (!fs.existsSync(CRON_RUNS_DIR)) {
    console.warn(`WARN: CRON_RUNS_DIR not found: ${CRON_RUNS_DIR}`);
    return events;
  }

  for (const fname of fs.readdirSync(CRON_RUNS_DIR)) {
    if (!fname.endsWith('.jsonl')) continue;
    const fpath = path.join(CRON_RUNS_DIR, fname);
    for (const line of fs.readFileSync(fpath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.action !== 'finished') continue;
        if (!e.usage) continue;
        if (e.ts < dayStart || e.ts > dayEnd) continue;
        if ((e.usage.total_tokens || 0) === 0) continue;
        events.push({
          ts: e.ts,
          model: e.model || 'unknown',
          provider: e.provider || 'anthropic',
          input_tokens: e.usage.input_tokens || 0,
          output_tokens: e.usage.output_tokens || 0,
          cache_creation_tokens: cacheCreationTokens(e.usage),
          cache_read_tokens: cacheReadTokens(e.usage),
          sessionKey: e.sessionKey || '',
        });
      } catch (_) {}
    }
  }
  return events;
}

// Server defaults to UTC for date_local; override via TOKENMAXX_USER_TIMEZONE if needed.
const SERVER_TIMEZONE = process.env.TOKENMAXX_USER_TIMEZONE || 'UTC';

function localDateInTz(isoUtc, tz) {
  return new Date(isoUtc).toLocaleDateString('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function buildUsageRow(event, workspaceId, userId, userSlug, context = 'openclaw') {
  const ts = new Date(event.ts).toISOString();
  const dateUtc = ts.slice(0, 10);
  return {
    workspace_id: workspaceId,
    user_id: userId,
    captured_at: ts,
    date_utc: dateUtc,
    date_local: localDateInTz(ts, SERVER_TIMEZONE),
    provider: event.provider,
    model: event.model,
    capture_method: captureMethodForProvider(event.provider, 'cli', context),
    aggregation_grain: 'event',
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cache_creation_tokens: event.cache_creation_tokens || 0,
    cache_read_tokens: event.cache_read_tokens || 0,
    token_share_pct: 100.0,
  };
}

// --- Incremental state helpers ---

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) {
    process.stderr.write(`WARN: unable to read state ${STATE_FILE}: ${err.message}\n`);
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

// --- Codex CLI sessions sweep ---

function hasUsageTokens(usage) {
  return Boolean(usage && typeof usage === 'object' && (
    Number.isFinite(usage.input_tokens) || Number.isFinite(usage.output_tokens) ||
    Number.isFinite(usage.total_tokens) || Number.isFinite(usage.prompt_tokens) ||
    Number.isFinite(usage.completion_tokens)
  ));
}

function collectUsageObjects(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (hasUsageTokens(obj.usage)) out.push(obj.usage);
  if (obj.info && typeof obj.info === 'object' && hasUsageTokens(obj.info.last_token_usage)) {
    out.push(obj.info.last_token_usage);
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && value !== obj.usage && value !== obj.info) {
      collectUsageObjects(value, out);
    }
  }
  return out;
}

function listJsonlFiles(rootDir) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const p = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...listJsonlFiles(p));
    else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push(p);
    }
  }
  return files;
}

function parseCodexSession(fpath) {
  const lines = fs.readFileSync(fpath, 'utf8').split('\n');
  const meta = {};
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
  let usageEvents = 0, lastTotalUsage = null;
  let model = 'gpt-5.3-codex';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'session_meta' && event.payload) Object.assign(meta, event.payload);
      if (event.model) model = event.model;
      if (event.payload && event.payload.model) model = event.payload.model;
      if (event.info && hasUsageTokens(event.info.total_token_usage)) {
        lastTotalUsage = event.info.total_token_usage;
      }
      for (const usage of collectUsageObjects(event)) {
        inputTokens += usage.input_tokens || usage.prompt_tokens || 0;
        outputTokens += usage.output_tokens || usage.completion_tokens || 0;
        cachedTokens += cacheReadTokens(usage);
        usageEvents++;
      }
    } catch (_) {}
  }

  if (lastTotalUsage) {
    inputTokens = lastTotalUsage.input_tokens || lastTotalUsage.prompt_tokens || 0;
    outputTokens = lastTotalUsage.output_tokens || lastTotalUsage.completion_tokens || 0;
    cachedTokens = cacheReadTokens(lastTotalUsage);
  }
  if (usageEvents === 0 || (inputTokens + outputTokens) === 0) return null;

  const ts = meta.timestamp
    ? new Date(meta.timestamp).toISOString()
    : new Date(fs.statSync(fpath).mtimeMs).toISOString();

  return { ts, model, provider: 'openai-codex', inputTokens, outputTokens, cachedTokens, meta };
}

async function processCodexSessions(state, workspaceId, userId, userSlug, dryRun, context = 'openclaw') {
  const sessionState = state['codex_sessions'] || { files: {} };
  const files = listJsonlFiles(CODEX_SESSIONS_DIR)
    .map(fpath => ({ fpath, stat: fs.statSync(fpath) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  const rows = [];
  let skipped = 0;

  for (const { fpath, stat } of files) {
    if (sessionState.files[fpath] === stat.mtimeMs) { skipped++; continue; }
    const session = parseCodexSession(fpath);
    if (!session) { sessionState.files[fpath] = stat.mtimeMs; skipped++; continue; }

    const dateUtc = session.ts.slice(0, 10);
    rows.push({
      workspace_id: workspaceId,
      user_id: userId,
      captured_at: session.ts,
      date_utc: dateUtc,
      date_local: localDateInTz(session.ts, SERVER_TIMEZONE),
      provider: 'openai-codex',
      model: session.model,
      capture_method: `openai-codex.ccusage.cli.${context}`,
      aggregation_grain: 'session',
      input_tokens: session.inputTokens,
      output_tokens: session.outputTokens,
      cache_creation_tokens: 0,
      cache_read_tokens: session.cachedTokens,
      token_share_pct: 100.0,
      _fpath: fpath,
      _mtime: stat.mtimeMs,
    });
  }

  const toWrite = rows.map(({ _fpath, _mtime, ...r }) => r);
  const result = await batchInsertEvents(toWrite, dryRun);

  if (!dryRun && result.failed === 0) {
    for (const r of rows) sessionState.files[r._fpath] = r._mtime;
    state['codex_sessions'] = sessionState;
    saveState(state);
  }

  return { inserted: result.inserted, skipped, failed: result.failed };
}

// --- Date helpers ---

function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const dates = [];
  let cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
server-capture.js -- OpenClaw server JSONL usage -> Supabase usage_events

Usage:
  node server-capture.js
  node server-capture.js --date 2026-05-29
  node server-capture.js --backfill 2026-05-01
  node server-capture.js --dry-run

Options:
  --date YYYY-MM-DD         Process a specific date (default: yesterday UTC)
  --backfill YYYY-MM-DD     Process all dates from this date to yesterday
  --dry-run                 Print what would be written, don't write to Supabase
  --user-slug <slug>        User identifier (default: openclaw-server or TOKENMAXX_USER_SLUG)
  --workspace-id <uuid>     Workspace UUID (overrides TOKENMAXX_WORKSPACE_ID)
  --skip-codex              Skip Codex CLI session sweep
  --state-file <path>       State file path (default: /home/openclaw/.config/tokenmaxx/server-state.json)
  --codex-sessions-dir <p>  Codex CLI sessions directory
  --help, -h                Show this message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
  TOKENMAXX_WORKSPACE_ID    Required (or --workspace-id)
  TOKENMAXX_USER_SLUG       Default user slug (default: openclaw-server)
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  // Parse flags
  const dryRun = args.includes('--dry-run');
  const skipCodex = args.includes('--skip-codex');

  const userSlugIdx = args.indexOf('--user-slug');
  const userSlug = (userSlugIdx !== -1 && args[userSlugIdx + 1])
    ? args[userSlugIdx + 1]
    : (process.env.TOKENMAXX_USER_SLUG || 'openclaw-server');

  const workspaceArgIdx = args.indexOf('--workspace-id');
  const workspaceArg = (workspaceArgIdx !== -1 && args[workspaceArgIdx + 1])
    ? args[workspaceArgIdx + 1]
    : process.env.TOKENMAXX_WORKSPACE_ID;
  if (!workspaceArg) {
    console.error('Error: TOKENMAXX_WORKSPACE_ID env var or --workspace-id flag is required');
    process.exit(1);
  }

  const stateFileIdx = args.indexOf('--state-file');
  if (stateFileIdx !== -1 && args[stateFileIdx + 1]) {
    STATE_FILE = args[stateFileIdx + 1].replace(/^~/, process.env.HOME || '~');
  }

  const codexDirIdx = args.indexOf('--codex-sessions-dir');
  if (codexDirIdx !== -1 && args[codexDirIdx + 1]) {
    CODEX_SESSIONS_DIR = args[codexDirIdx + 1];
  }

  const dateIdx = args.indexOf('--date');
  const backfillIdx = args.indexOf('--backfill');
  let dates;
  if (backfillIdx !== -1 && args[backfillIdx + 1]) {
    const from = args[backfillIdx + 1];
    dates = dateRange(from, yesterdayUTC());
    console.log(`Backfill mode: ${from} to ${yesterdayUTC()} (${dates.length} days)`);
  } else if (dateIdx !== -1 && args[dateIdx + 1]) {
    dates = [args[dateIdx + 1]];
  } else {
    dates = [yesterdayUTC()];
  }

  console.log(`server-capture.js -- user-slug: ${userSlug}${dryRun ? ' [DRY RUN]' : ''}\n`);

  // Resolve IDs
  const [workspaceId, userId] = await Promise.all([
    getWorkspaceId(workspaceArg),
    getUserId(userSlug),
  ]);
  console.log(`Workspace: ${workspaceId}`);
  console.log(`User: ${userId} (${userSlug})\n`);

  const state = loadState();
  let totalInserted = 0, totalFailed = 0;

  // Process cron events by date
  for (const date of dates) {
    const events = readCronEventsForDate(date);
    if (events.length === 0) {
      console.log(`  ${date}: no cron events`);
      continue;
    }
    console.log(`  ${date}: ${events.length} events`);
    const rows = events.map(e => buildUsageRow(e, workspaceId, userId, userSlug));
    const result = await batchInsertEvents(rows, dryRun);
    totalInserted += result.inserted;
    totalFailed += result.failed;
    console.log(`    -> ${result.inserted} inserted, ${result.failed} failed`);
  }

  // Codex CLI sweep
  if (!skipCodex) {
    console.log('\nCodex CLI session sweep...');
    const codexResult = await processCodexSessions(state, workspaceId, userId, userSlug, dryRun);
    console.log(`  ${codexResult.inserted} inserted, ${codexResult.skipped} skipped, ${codexResult.failed} failed`);
    totalInserted += codexResult.inserted;
    totalFailed += codexResult.failed;
  }

  console.log(`\nDone: ${totalInserted} inserted, ${totalFailed} failed`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
