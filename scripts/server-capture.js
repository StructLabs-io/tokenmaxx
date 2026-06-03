#!/usr/bin/env node
/**
 * server-capture.js -- OpenClaw server JSONL usage -> Supabase usage_events
 *
 * Sweeps:
 *   1. OpenClaw cron run JSONLs (per-run `aggregation_grain: 'turn'`)
 *   2. Codex CLI session JSONLs (per-session `aggregation_grain: 'session'`,
 *      with session_id, session_title, project_id populated)
 *   3. Claude Code via ccusage CLI (per-day `aggregation_grain: 'daily'`)
 *
 * Mirrors local-capture.js: rolling-window scan + upsert (no state file).
 * Supabase's unique constraint handles dedup.
 *
 * capture_method format: <provider>.<tool>.<surface>.<context>
 *   e.g. anthropic.ccusage.cli.openclaw
 *        openai-codex.ccusage.cli.openclaw
 *
 * Usage:
 *   node server-capture.js
 *   node server-capture.js --date 2026-05-29       # cron rows for one date
 *   node server-capture.js --backfill 2026-05-01   # cron rows from date → yesterday
 *   node server-capture.js --dry-run
 *   node server-capture.js --skip-codex --skip-claude
 *
 * Environment:
 *   SUPABASE_URL                 Required
 *   SUPABASE_SERVICE_ROLE_KEY    Required
 *   TOKENMAXX_WORKSPACE_ID       Required (or --workspace-id)
 *   TOKENMAXX_USER_SLUG          Default: openclaw-server
 *   TOKENMAXX_CAPTURE_CONTEXT    Default: openclaw (4th segment of capture_method)
 *   TOKENMAXX_USER_TIMEZONE      Default: UTC (used for date_local derivation)
 *   TOKENMAXX_LOOKBACK_DAYS      Default: 7 (rolling-window for Codex + Claude sweeps)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CRON_RUNS_DIR = '/home/openclaw/.openclaw/cron/runs';
let CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || '/home/openclaw/.codex/sessions';

const SERVER_TIMEZONE = process.env.TOKENMAXX_USER_TIMEZONE || 'UTC';
const CAPTURE_CONTEXT = process.env.TOKENMAXX_CAPTURE_CONTEXT || 'openclaw';
const LOOKBACK_DAYS = parseInt(process.env.TOKENMAXX_LOOKBACK_DAYS || '7', 10);

// Maps provider field (from cron JSONL) -> capture method provider segment
const PROVIDER_MAP = {
  'anthropic':    'anthropic',
  'openai':       'openai-codex',
  'openai-codex': 'openai-codex',
  'google':       'google',
  'openrouter':   'openrouter',
};

function captureMethodForProvider(provider, surface = 'cli', context = CAPTURE_CONTEXT) {
  const p = PROVIDER_MAP[provider] || provider;
  return `${p}.ccusage.${surface}.${context}`;
}

function localDateInTz(isoUtc, tz) {
  return new Date(isoUtc).toLocaleDateString('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
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
      // on_conflict targets the unique constraint columns so PostgREST
      // upserts rather than rejecting with 409.
      await supabaseRequest(
        'usage_events?on_conflict=user_id,capture_method,session_id,model,date_utc',
        'POST', chunk, {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
      );
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
  for (const v of values) { if (Number.isFinite(v)) return v; }
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
    usage.cache_read_input_tokens, usage.cache_read_tokens,
    usage.prompt_cache_read_tokens, usage.cached_tokens, usage.cached_input_tokens,
    usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens,
    usage.input_token_details && usage.input_token_details.cached_tokens,
    usage.input_tokens_details && usage.input_tokens_details.cached_tokens
  );
}

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

// --- Cron JSONL reader (server-only) ---

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
          runId: e.runId || `${fname}:${e.ts}`,
        });
      } catch (_) {}
    }
  }
  return events;
}

function buildCronUsageRow(event, workspaceId, userId) {
  const ts = new Date(event.ts).toISOString();
  const dateUtc = ts.slice(0, 10);
  // sessionKey from the cron JSONL keeps dedup honest across re-runs; fall
  // back to runId so each cron invocation is at least unique per (model, date).
  const sessionId = event.sessionKey || event.runId;
  return {
    workspace_id: workspaceId,
    user_id: userId,
    captured_at: ts,
    date_utc: dateUtc,
    date_local: localDateInTz(ts, SERVER_TIMEZONE),
    provider: event.provider,
    model: event.model,
    capture_method: captureMethodForProvider(event.provider, 'cli', CAPTURE_CONTEXT),
    // 'turn' = per-cron-invocation. 'event' was wrong — schema check
    // constraint allows only ('turn', 'session', 'daily', 'batch').
    aggregation_grain: 'turn',
    session_id: sessionId,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cache_creation_tokens: event.cache_creation_tokens || 0,
    cache_read_tokens: event.cache_read_tokens || 0,
    token_share_pct: 100.0,
  };
}

// --- Codex CLI session sweep ---

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
  let firstUserPrompt = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'session_meta' && event.payload) Object.assign(meta, event.payload);
      // First user message text -> session_title
      if (!firstUserPrompt && event.role === 'user' && typeof event.content === 'string') {
        firstUserPrompt = event.content;
      } else if (!firstUserPrompt && event.role === 'user' && Array.isArray(event.content)) {
        for (const c of event.content) {
          if (c && typeof c.text === 'string') { firstUserPrompt = c.text; break; }
          else if (typeof c === 'string') { firstUserPrompt = c; break; }
        }
      } else if (!firstUserPrompt && event.payload && event.payload.role === 'user') {
        const c = event.payload.content;
        if (typeof c === 'string') firstUserPrompt = c;
        else if (Array.isArray(c)) {
          for (const item of c) {
            if (item && typeof item.text === 'string') { firstUserPrompt = item.text; break; }
          }
        }
      }
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

  let title = null;
  if (firstUserPrompt) {
    title = firstUserPrompt
      .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    if (!title) title = null;
  }

  return {
    ts,
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    sessionId: meta.id || null,
    cwd: meta.cwd || null,
    title,
  };
}

// cwd -> project_id map. Server paths (/home/openclaw/...) are first; Mac
// paths kept here too so a future shared lib doesn't lose them.
const PROJECT_BY_CWD_RULES = [
  [/\/home\/openclaw\/repos\/mantis(\/|$)/, 'd2572c4b-e862-46be-9153-e25a1cc2142b'],
  [/\/home\/openclaw\/repos\/n9c-repo/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/home\/openclaw\/neuro9circuit-openclaw/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/home\/openclaw\/\.openclaw/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/home\/openclaw\/repos\/n9c-site/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/home\/openclaw\/repos\/structlabsio(\/|$)/, '13bc5073-a04d-4ffb-9ad4-0a9d3f12cce6'],
  [/\/home\/openclaw\/repos\/wayang/, '15f798cd-f654-41bb-bcef-a7e1ccad7a33'],
];

function projectIdForCwd(cwd) {
  if (!cwd) return null;
  for (const [pattern, pid] of PROJECT_BY_CWD_RULES) {
    if (pattern.test(cwd)) return pid;
  }
  return null;
}

// Rolling-window scan: re-process Codex sessions modified in the last
// LOOKBACK_DAYS days. Supabase upsert dedupes via the unique constraint.
// No state file — if a day failed to capture, the next run backfills.
async function processCodexSessions(workspaceId, userId, dryRun) {
  const cutoffMs = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const allFiles = listJsonlFiles(CODEX_SESSIONS_DIR)
    .map(fpath => ({ fpath, stat: fs.statSync(fpath) }))
    .filter(({ stat }) => stat.mtimeMs >= cutoffMs)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  console.log(`Scanning ${allFiles.length} Codex session files modified in last ${LOOKBACK_DAYS} days`);

  const rows = [];
  for (const { fpath } of allFiles) {
    const session = parseCodexSession(fpath);
    if (!session) continue;
    rows.push({
      workspace_id: workspaceId,
      user_id: userId,
      captured_at: session.ts,
      date_utc: session.ts.slice(0, 10),
      date_local: localDateInTz(session.ts, SERVER_TIMEZONE),
      provider: 'openai-codex',
      model: session.model,
      capture_method: `openai-codex.ccusage.cli.${CAPTURE_CONTEXT}`,
      aggregation_grain: 'session',
      session_id: session.sessionId,
      session_title: session.title,
      project_id: projectIdForCwd(session.cwd),
      input_tokens: session.inputTokens,
      output_tokens: session.outputTokens,
      cache_creation_tokens: 0,
      cache_read_tokens: session.cachedTokens,
      token_share_pct: 100.0,
    });
  }

  return batchInsertEvents(rows, dryRun);
}

/**
 * Pull last N days of Claude Code usage via ccusage and produce one row per
 * (date, model). Synthetic session_id keeps the unique constraint deterministic.
 */
function collectClaudeViaCcusage(workspaceId, userId, lookbackDays) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const sinceArg = since.toISOString().slice(0, 10).replace(/-/g, '');

  let raw;
  try {
    raw = execFileSync('npx', ['ccusage@latest', 'daily', '--json', '--since', sinceArg], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`  ccusage CLI failed: ${err.message}`);
    return [];
  }

  let data;
  try { data = JSON.parse(raw); }
  catch (err) {
    console.error(`  ccusage JSON parse failed: ${err.message}`);
    return [];
  }

  const out = [];
  for (const day of data.daily ?? []) {
    if (day.agent && day.agent !== 'all' && day.agent !== 'claude') continue;
    // ccusage >=11 uses "date"; earlier builds used "period". Accept both.
    const date = day.date ?? day.period;
    if (!date) continue;
    for (const m of day.modelBreakdowns ?? []) {
      const modelName = m.modelName;
      if (!modelName || modelName === '<synthetic>') continue;
      const input = m.inputTokens ?? 0;
      const output = m.outputTokens ?? 0;
      const cacheCreate = m.cacheCreationTokens ?? 0;
      const cacheRead = m.cacheReadTokens ?? 0;
      const total = input + output + cacheCreate + cacheRead;
      if (total === 0) continue;
      const capturedAt = new Date(`${date}T00:00:00Z`).toISOString();
      out.push({
        workspace_id: workspaceId,
        user_id: userId,
        captured_at: capturedAt,
        date_utc: date,
        date_local: date,
        provider: 'anthropic',
        model: modelName,
        capture_method: `anthropic.ccusage.cli.${CAPTURE_CONTEXT}`,
        aggregation_grain: 'daily',
        session_id: `daily-${date}-${modelName}`,
        input_tokens: input,
        output_tokens: output,
        cache_creation_tokens: cacheCreate,
        cache_read_tokens: cacheRead,
        token_share_pct: 100.0,
        cost_usd: typeof m.cost === 'number' ? m.cost : null,
      });
    }
  }
  return out;
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
  node server-capture.js --date 2026-05-29       # cron rows for one date
  node server-capture.js --backfill 2026-05-01   # cron rows from date -> yesterday
  node server-capture.js --dry-run

Options:
  --date YYYY-MM-DD         Process cron events for one date (default: yesterday UTC)
  --backfill YYYY-MM-DD     Process cron events from date through yesterday
  --dry-run                 Print what would be written, don't write
  --user-slug <slug>        Default: openclaw-server (or TOKENMAXX_USER_SLUG)
  --workspace-id <uuid>     Overrides TOKENMAXX_WORKSPACE_ID
  --skip-codex              Skip Codex CLI session sweep
  --skip-claude             Skip Claude Code (ccusage) sweep
  --codex-sessions-dir <p>  Codex CLI sessions directory
  --help, -h                Show this message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
  TOKENMAXX_WORKSPACE_ID    Required (or --workspace-id)
  TOKENMAXX_USER_SLUG       Default: openclaw-server
  TOKENMAXX_CAPTURE_CONTEXT Default: openclaw
  TOKENMAXX_USER_TIMEZONE   Default: UTC
  TOKENMAXX_LOOKBACK_DAYS   Default: 7 (Codex + Claude rolling window)
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  const skipCodex = args.includes('--skip-codex');
  const skipClaude = args.includes('--skip-claude');

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

  console.log(`server-capture.js -- user-slug: ${userSlug}, context: ${CAPTURE_CONTEXT}${dryRun ? ' [DRY RUN]' : ''}\n`);

  const [workspaceId, userId] = await Promise.all([
    getWorkspaceId(workspaceArg),
    getUserId(userSlug),
  ]);
  console.log(`Workspace: ${workspaceId}`);
  console.log(`User: ${userId} (${userSlug})\n`);

  let totalInserted = 0, totalFailed = 0;

  // 1. Cron events by date
  for (const date of dates) {
    const events = readCronEventsForDate(date);
    if (events.length === 0) {
      console.log(`  ${date}: no cron events`);
      continue;
    }
    console.log(`  ${date}: ${events.length} cron events`);
    const rows = events.map(e => buildCronUsageRow(e, workspaceId, userId));
    const result = await batchInsertEvents(rows, dryRun);
    totalInserted += result.inserted;
    totalFailed += result.failed;
    console.log(`    -> ${result.inserted} upserted, ${result.failed} failed`);
  }

  // 2. Codex CLI rolling-window sweep
  if (!skipCodex) {
    console.log('\nCodex CLI session sweep...');
    const codexResult = await processCodexSessions(workspaceId, userId, dryRun);
    console.log(`  Codex: ${codexResult.inserted} upserted, ${codexResult.failed} failed`);
    totalInserted += codexResult.inserted;
    totalFailed += codexResult.failed;
  }

  // 3. Claude Code (ccusage) sweep
  if (!skipClaude) {
    console.log('\nClaude Code (ccusage) sweep...');
    const claudeRows = collectClaudeViaCcusage(workspaceId, userId, LOOKBACK_DAYS);
    console.log(`  ${claudeRows.length} (date, model) rollups to upsert`);
    const claudeResult = await batchInsertEvents(claudeRows, dryRun);
    console.log(`  Claude: ${claudeResult.inserted} upserted, ${claudeResult.failed} failed`);
    totalInserted += claudeResult.inserted;
    totalFailed += claudeResult.failed;
  }

  console.log(`\nDone: ${totalInserted} upserted, ${totalFailed} failed (lookback: ${LOOKBACK_DAYS}d)`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
