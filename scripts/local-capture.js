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
const { execFileSync } = require('child_process');
const HOME = process.env.HOME || require('os').homedir();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(HOME, '.codex', 'sessions');
let STATE_FILE = process.env.TOKENMAXX_LOCAL_STATE_FILE || path.join(HOME, '.config', 'tokenmaxx', 'local-state.json');

// User's local timezone for date_local derivation. Defaults to MYT for Ben's MacBook.
const USER_TIMEZONE = process.env.TOKENMAXX_USER_TIMEZONE || 'Asia/Kuala_Lumpur';

// Rolling-window backfill: each run re-processes session files modified in
// the last N days. Supabase upsert dedupes. This mirrors the ECIS pattern.
const LOOKBACK_DAYS = parseInt(process.env.TOKENMAXX_LOOKBACK_DAYS || '7', 10);

// 4th segment of capture_method — distinguishes per-machine context.
// MacBook default: ben_macbook. Override on the n9c server with `openclaw`.
const CAPTURE_CONTEXT = process.env.TOKENMAXX_CAPTURE_CONTEXT || 'ben_macbook';

// Convert an ISO UTC timestamp to a YYYY-MM-DD date in the given IANA timezone.
function localDateInTz(isoUtc, tz) {
  // en-CA renders as YYYY-MM-DD natively.
  return new Date(isoUtc).toLocaleDateString('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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
      await supabaseRequest(
        // on_conflict targets the unique constraint columns directly so
        // PostgREST upserts rather than rejecting with 409.
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
  let firstUserPrompt = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'session_meta' && event.payload) Object.assign(meta, event.payload);
      // First user message text — used as session_title.
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

  // Trim title to 200 chars, strip environment_context wrappers.
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

// cwd → project_id map. Same rules as the v1 backfill script + the
// reattribute-codex-buckets.js patterns. Adding new clients = add a rule.
const PROJECT_BY_CWD_RULES = [
  [/\/repos\/mantis(\/|$)/, 'd2572c4b-e862-46be-9153-e25a1cc2142b'],
  [/\/Projects\/n9c-repo/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/neuro9circuit-openclaw/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/repos\/n9c-site/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\.codex\/worktrees\/[^/]+\/n9c-repo/, '891449c0-af2b-415d-af6a-ac7d3c9f4756'],
  [/\/Omniventure_n8n/, '81e96884-7c9a-42c6-9372-fa916b9431ec'],
  [/\/Clips23/, 'd42a649e-3a39-48be-abfd-0e75aefea0bd'],
  [/\/Desktop\/Portfolio Profile Upgrade/, '13bc5073-a04d-4ffb-9ad4-0a9d3f12cce6'],
  [/\/repos\/structlabsio(\/|$)/, '13bc5073-a04d-4ffb-9ad4-0a9d3f12cce6'],
  [/\/structlabsio-variations/, '13bc5073-a04d-4ffb-9ad4-0a9d3f12cce6'],
  [/\/repos\/wayang/, '15f798cd-f654-41bb-bcef-a7e1ccad7a33'],
  [/\/Documents\/Ausmat QA/, '4e27b1c9-a687-43d2-880e-86412c62dec4'],
  [/\/Documents\/Codex\/.+austmat/i, '4e27b1c9-a687-43d2-880e-86412c62dec4'],
  [/\/Downloads\/WhatsApp Chat/, '4e27b1c9-a687-43d2-880e-86412c62dec4'],
  [/\/Documents\/Auknowra Apps/, '2eb352f8-df4a-43a9-b3f4-35acd6e6d35c'],
];

function projectIdForCwd(cwd) {
  if (!cwd) return null;
  for (const [pattern, pid] of PROJECT_BY_CWD_RULES) {
    if (pattern.test(cwd)) return pid;
  }
  return null;
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

  // Rolling-window scan: always re-process the last LOOKBACK_DAYS days of
  // session files. We don't gate on a state file — Supabase upsert dedupes.
  // This matches the ECIS pattern: idempotent rescan + upsert means a day
  // that failed to capture (script broken, DB down, etc.) gets backfilled
  // automatically on the next run.
  const lookbackMs = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - lookbackMs;

  const allFiles = listJsonlFiles(CODEX_SESSIONS_DIR)
    .map(fpath => ({ fpath, stat: fs.statSync(fpath) }))
    .filter(({ stat }) => stat.mtimeMs >= cutoffMs)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

  console.log(`Scanning ${allFiles.length} session files modified in last ${LOOKBACK_DAYS} days`);

  const rows = [];
  for (const { fpath } of allFiles) {
    const session = parseCodexSession(fpath);
    if (!session) continue;

    rows.push({
      workspace_id: workspaceId,
      user_id: userId,
      captured_at: session.ts,
      date_utc: session.ts.slice(0, 10),
      date_local: localDateInTz(session.ts, USER_TIMEZONE),
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

  console.log(`  ${rows.length} sessions to upsert`);
  const codexResult = await batchInsertEvents(rows, dryRun);
  console.log(`  Codex: ${codexResult.inserted} upserted, ${codexResult.failed} failed`);

  // --- Claude Code (ccusage) sweep — same rolling window + upsert ---
  console.log('\nClaude Code (ccusage) sweep…');
  const claudeRows = collectClaudeViaCcusage(workspaceId, userId, LOOKBACK_DAYS);
  console.log(`  ${claudeRows.length} (date, model) rollups to upsert`);
  const claudeResult = await batchInsertEvents(claudeRows, dryRun);
  console.log(`  Claude: ${claudeResult.inserted} upserted, ${claudeResult.failed} failed`);

  console.log(`\nDone (lookback: ${LOOKBACK_DAYS}d)`);
}

/**
 * Pull the last N days of Claude Code usage via the ccusage CLI and
 * convert to one usage_events row per (date, model). Synthetic session_id
 * `daily-<date>-<model>` keeps the unique constraint happy and makes upserts
 * deterministic across runs.
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
    const date = day.period;
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
        date_local: date, // ccusage already aggregates by calendar day
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

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
