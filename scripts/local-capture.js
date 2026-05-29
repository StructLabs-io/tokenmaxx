#!/usr/bin/env node
/**
 * local-capture.js -- MacBook local JSONL usage -> Supabase usage_events
 *
 * Same as server-capture.js but with MacBook-appropriate defaults:
 *   - user-slug: ben-macbook (instead of openclaw-server)
 *   - state file: ~/.config/tokenmaxx/local-state.json
 *   - Codex sessions dir: ~/.codex/sessions
 *   - No cron runs dir (MacBook doesn't run OpenClaw cron)
 *
 * Usage:
 *   node local-capture.js
 *   node local-capture.js --dry-run
 *   node local-capture.js --help
 *
 * Options:
 *   --dry-run                    Print what would be written, don't write
 *   --user-slug <slug>           User slug (default: ben-macbook)
 *   --workspace-id <uuid>        Workspace UUID (overrides TOKENMAXX_WORKSPACE_ID)
 *   --codex-sessions-dir <path>  Codex sessions dir (default: ~/.codex/sessions)
 *   --state-file <path>          State file (default: ~/.config/tokenmaxx/local-state.json)
 *   --help, -h                   Show this message
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 *   TOKENMAXX_WORKSPACE_ID    Required (or --workspace-id)
 *   TOKENMAXX_USER_SLUG       Default user slug (overridden by --user-slug)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const HOME = process.env.HOME || require('os').homedir();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(HOME, '.codex', 'sessions');
let STATE_FILE = process.env.TOKENMAXX_LOCAL_STATE_FILE || path.join(HOME, '.config', 'tokenmaxx', 'local-state.json');

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
  if (!rows || rows.length === 0) throw new Error(`User with slug "${slug}" not found`);
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
  for (const v of values) { if (Number.isFinite(v)) return v; }
  return 0;
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

  return { ts, model, inputTokens, outputTokens, cachedTokens };
}

// --- State helpers ---

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

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
local-capture.js -- MacBook local JSONL usage -> Supabase usage_events

Sweeps Codex CLI session files for new usage events.
Default user slug: ben-macbook.

Usage:
  node local-capture.js
  node local-capture.js --dry-run

Options:
  --dry-run                  Print what would be written, don't write
  --user-slug <slug>         User slug (default: ben-macbook or TOKENMAXX_USER_SLUG)
  --workspace-id <uuid>      Workspace UUID (overrides TOKENMAXX_WORKSPACE_ID)
  --codex-sessions-dir <p>   Codex sessions dir (default: ~/.codex/sessions)
  --state-file <path>        State file (default: ~/.config/tokenmaxx/local-state.json)
  --help, -h                 Show this message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
  TOKENMAXX_WORKSPACE_ID    Required (or --workspace-id)
  TOKENMAXX_USER_SLUG       Default user slug
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');

  const userSlugIdx = args.indexOf('--user-slug');
  const userSlug = (userSlugIdx !== -1 && args[userSlugIdx + 1])
    ? args[userSlugIdx + 1]
    : (process.env.TOKENMAXX_USER_SLUG || 'ben-macbook');

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
    STATE_FILE = args[stateFileIdx + 1].replace(/^~/, HOME);
  }

  const codexDirIdx = args.indexOf('--codex-sessions-dir');
  if (codexDirIdx !== -1 && args[codexDirIdx + 1]) {
    CODEX_SESSIONS_DIR = args[codexDirIdx + 1].replace(/^~/, HOME);
  }

  console.log(`local-capture.js -- user-slug: ${userSlug}${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`Codex sessions dir: ${CODEX_SESSIONS_DIR}`);
  console.log(`State file: ${STATE_FILE}\n`);

  const [workspaceId, userId] = await Promise.all([
    getWorkspaceId(workspaceArg),
    getUserId(userSlug),
  ]);
  console.log(`Workspace: ${workspaceId}`);
  console.log(`User: ${userId} (${userSlug})\n`);

  const state = loadState();
  const sessionState = state['codex_sessions'] || { files: {} };

  const files = listJsonlFiles(CODEX_SESSIONS_DIR)
    .map(fpath => ({ fpath, stat: fs.statSync(fpath) }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  console.log(`Found ${files.length} Codex session files`);

  const rows = [];
  let skipped = 0;

  for (const { fpath, stat } of files) {
    if (sessionState.files[fpath] === stat.mtimeMs) { skipped++; continue; }
    const session = parseCodexSession(fpath);
    if (!session) { sessionState.files[fpath] = stat.mtimeMs; skipped++; continue; }

    rows.push({
      workspace_id: workspaceId,
      user_id: userId,
      captured_at: session.ts,
      date_utc: session.ts.slice(0, 10),
      provider: 'openai-codex',
      model: session.model,
      capture_method: `openai-codex.ccusage.cli.ben-macbook`,
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

  console.log(`  ${rows.length} new sessions, ${skipped} already captured`);

  const toWrite = rows.map(({ _fpath, _mtime, ...r }) => r);
  const result = await batchInsertEvents(toWrite, dryRun);

  if (!dryRun && result.failed === 0) {
    for (const r of rows) sessionState.files[r._fpath] = r._mtime;
    state['codex_sessions'] = sessionState;
    saveState(state);
    console.log(`State saved to ${STATE_FILE}`);
  }

  console.log(`\nDone: ${result.inserted} inserted, ${skipped} skipped, ${result.failed} failed`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
