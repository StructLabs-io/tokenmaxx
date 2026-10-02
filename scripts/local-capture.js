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
const { runCcusageCodexSessions, codexRecordsFromCcusage, codexSessionsDirs } = require('./lib/codex-ccusage.cjs');
const { parseVersion, compareVersions, checkVersion, childEnvironment } = require('./lib/ccusage-version.cjs');
const { collectClaudeCacheSplit, cacheCreation1hForRow } = require('./lib/claude-cache-split.cjs');
const { filterMinDate, guardUpsertRows } = require('./lib/upsert-guard.cjs');
// Explicit CLI timezone prevents ccusage config files from changing daily grouping.
const CCUSAGE_TIMEZONE = childEnvironment().TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
const HOME = process.env.HOME || require('os').homedir();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let CODEX_SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(HOME, '.codex', 'sessions');
let CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects');
let STATE_FILE = process.env.TOKENMAXX_LOCAL_STATE_FILE || path.join(HOME, '.config', 'tokenmaxx', 'local-state.json');

// User's local timezone for date_local derivation. Defaults to MYT for Ben's MacBook.
const USER_TIMEZONE = process.env.TOKENMAXX_USER_TIMEZONE || 'Asia/Kuala_Lumpur';

// Rolling-window backfill: each run re-processes session files modified in
// the last N days. Supabase upsert dedupes. This mirrors the ECIS pattern.
const LOOKBACK_DAYS = parseInt(process.env.TOKENMAXX_LOOKBACK_DAYS || '7', 10);
const CLAUDE_ATTRIBUTION_MIN_SHARE = Number.parseFloat(
  process.env.TOKENMAXX_CLAUDE_ATTRIBUTION_MIN_SHARE || '0.58',
);

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

/**
 * Deduplicate rows on the unique constraint key before batching.
 * Postgres raises "ON CONFLICT DO UPDATE command cannot affect row a second
 * time" when two rows in the same INSERT share the same constrained values.
 * Last-write-wins: later rows in the input array overwrite earlier ones.
 */
function deduplicateRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = [
      row.user_id,
      row.capture_method,
      row.session_id,
      row.model,
      row.date_utc,
    ].join('\x00');
    seen.set(key, row); // last occurrence wins
  }
  return [...seen.values()];
}

async function batchInsertEvents(rows, dryRun) {
  if (rows.length === 0) return { inserted: 0, failed: 0 };

  // Dedup before any batch split — prevents the Postgres "cannot affect row
  // a second time" error when the same session appears in multiple scan passes.
  let deduped = deduplicateRows(rows);
  if (deduped.length < rows.length) {
    console.log(`    Deduped ${rows.length - deduped.length} duplicate rows before upsert`);
  }

  const filtered = filterMinDate(deduped, process.env.TOKENMAXX_MIN_DATE);
  if (filtered.length < deduped.length) console.log(`    Minimum date dropped ${deduped.length - filtered.length} rows`);
  deduped = filtered;

  if (dryRun) {
    for (const row of deduped) {
      console.log(`    [dry-run] ${row.provider}/${row.model} ${row.date_utc} in:${row.input_tokens} out:${row.output_tokens}`);
    }
    return { inserted: deduped.length, failed: 0 };
  }
  deduped = await guardUpsertRows(deduped, supabaseRequest, {
    allowShrink: process.env.TOKENMAXX_ALLOW_SHRINK === '1',
    verbose: process.argv.includes('--verbose'),
  });
  const BATCH = parseInt(process.env.TOKENMAXX_UPSERT_BATCH_SIZE || '25', 10);
  let inserted = 0, failed = 0;
  // Important: do not send project_id/project_hint when we have no label.
  // PostgREST upsert updates supplied columns on conflict; sending null here
  // wipes later manual/AI attribution during the rolling-window recapture.
  const labelled = [];
  const unlabelled = [];
  for (const row of deduped) {
    if (row.project_id || row.project_hint) {
      const copy = { ...row };
      if (copy.project_id == null) delete copy.project_id;
      if (copy.project_hint == null) delete copy.project_hint;
      labelled.push(copy);
    } else {
      const copy = { ...row };
      delete copy.project_id;
      delete copy.project_hint;
      unlabelled.push(copy);
    }
  }

  for (const group of [labelled, unlabelled]) {
    for (let i = 0; i < group.length; i += BATCH) {
      const chunk = group.slice(i, i + BATCH);
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
  }
  return { inserted, failed };
}

const PROJECT_IDS = {
  '10x-ceos': '0dd7535e-7b4d-4c53-aab4-e62a85708d0c',
  'auknowra-apps': '2eb352f8-df4a-43a9-b3f4-35acd6e6d35c',
  'internal-structlabs-io-projects': '1eab0b8a-34a4-4d8a-ab13-95bbc0e30ea3',
  'marketing': '13bc5073-a04d-4ffb-9ad4-0a9d3f12cce6',
  'mantis': 'd2572c4b-e862-46be-9153-e25a1cc2142b',
  'n9c': '891449c0-af2b-415d-af6a-ac7d3c9f4756',
  'omniventure': '81e96884-7c9a-42c6-9372-fa916b9431ec',
  'personal': '4e27b1c9-a687-43d2-880e-86412c62dec4',
  'structlabs-clips23': 'd42a649e-3a39-48be-abfd-0e75aefea0bd',
  'tokenmaxx': '5b0e13ee-f965-4821-9f2b-1c1cf33f1b6b',
  'wayang': '15f798cd-f654-41bb-bcef-a7e1ccad7a33',
};

function project(slug) {
  const id = PROJECT_IDS[slug];
  return id ? { slug, id } : null;
}

// cwd/title → project map. Specific client/product paths must precede broad
// n9c-repo rules because many agents operate from n9c worktrees while doing
// client/product work.
const PROJECT_LABEL_RULES = [
  {
    slug: 'omniventure',
    patterns: [
      /omniventure/i, /omnihoa/i, /bchoa/i, /client acquisition/i,
      /cold[- ]email/i, /deliverability/i, /hoa/i,
    ],
  },
  {
    slug: 'tokenmaxx',
    patterns: [
      /tokenmaxx/i, /tokenmaxxing/i, /quota[- ]codex/i,
      /quota monitor/i, /usage_events/i, /capture pipeline/i,
    ],
  },
  {
    slug: 'mantis',
    patterns: [
      /\/repos\/mantis(\/|$)/i, /\/mantis(\/|$)/i, /mantis/i,
      /polymarket/i, /DANTE/i, /trader[- ]profile/i, /sleeve[- ]b/i,
      /paper engine/i, /trading loop/i,
    ],
  },
  {
    slug: '10x-ceos',
    patterns: [
      /10XCEOs/i, /10x[-_ ]ceos/i, /strategy coach/i,
      /mastery/i, /onboarding videos/i,
    ],
  },
  {
    slug: 'wayang',
    patterns: [/\/repos\/wayang(\/|$)/i, /wayang/i, /Run It on AI/i],
  },
  {
    slug: 'marketing',
    patterns: [
      /\/repos\/structlabsio(\/|$)/i, /structlabsio-variations/i,
      /portfolio profile/i, /marketing site/i, /content audit/i,
      /senior UI UX designer/i,
    ],
  },
  {
    slug: 'auknowra-apps',
    patterns: [/Auknowra Apps/i],
  },
  {
    slug: 'structlabs-clips23',
    patterns: [/Clips23/i],
  },
  {
    slug: 'internal-structlabs-io-projects',
    patterns: [/Ausmat QA/i, /austmat/i, /WhatsApp Chat/i],
  },
  {
    slug: 'personal',
    patterns: [/coachcleo/i, /personal/i],
  },
  {
    slug: 'n9c',
    patterns: [
      /\/Projects\/n9c-repo/i, /\/workspace-[^/]+/i,
      /neuro9circuit-openclaw/i, /\/repos\/n9c-site/i,
      /N9C/i, /agent pipeline/i, /ANI/i, /Platform Status Monitor/i,
      /\bPSM\b/i,
    ],
  },
];

function classifyProject(...parts) {
  const haystack = parts.filter(Boolean).join('\n');
  if (!haystack) return null;
  for (const rule of PROJECT_LABEL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return project(rule.slug);
    }
  }
  return null;
}

// cwd → project_id map kept for compatibility with older callers.
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
  return classifyProject(cwd)?.id ?? null;
}

function attributionForSession(session, sourcePath = null) {
  return classifyProject(session.cwd, session.title, sourcePath);
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

function collectCodexViaCcusage(cutoffMs) {
  try {
    const configuredHome = process.env.CODEX_HOME;
    const explicitDir = process.env.CODEX_SESSIONS_DIR || process.argv.includes('--codex-sessions-dir');
    const env = childEnvironment();
    delete env.CODEX_HOME;
    if (configuredHome || explicitDir) env.CODEX_HOME = explicitDir ? path.dirname(CODEX_SESSIONS_DIR) : configuredHome;
    const sessionsDirs = explicitDir
      ? [CODEX_SESSIONS_DIR, path.join(path.dirname(CODEX_SESSIONS_DIR), 'archived_sessions')]
      : codexSessionsDirs(env);
    const binary = resolveCcusageBin({ quiet: true });
    const direct = binary.native || binary.bare;
    const command = direct ? binary.file : (process.env.NODE_BIN || process.execPath);
    const args = direct ? [] : [binary.file];
    const json = runCcusageCodexSessions({ command, args, env });
    const records = codexRecordsFromCcusage(json, { sessionsDirs, cutoffMs });
    console.log(`  Codex sessions skipped for missing files: ${records.skippedMissingFiles}`);
    return records;
  } catch (err) {
    console.error(`  Codex ccusage failed: ${String(err.message).replace(/\s+/g, ' ')}`);
    return [];
  }
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

  const rows = [];
  for (const session of collectCodexViaCcusage(cutoffMs)) {
    const attribution = attributionForSession(session, session.sourcePath);
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
      source_path: session.sourcePath,
      session_title: session.title,
      project_id: attribution?.id ?? null,
      project_hint: attribution?.slug ?? null,
      input_tokens: session.inputTokens,
      output_tokens: session.outputTokens,
      cache_creation_tokens: session.cacheCreationTokens,
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
// Probe explicit override, Homebrew, then PATH; highest accepted version wins.
function isNativeBinary(file) {
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return (buf[0] === 0x7f && buf[1] === 0x45) || // ELF
           (buf[0] === 0xcf && buf[1] === 0xfa) || // Mach-O 64-bit LE
           (buf[0] === 0xce && buf[1] === 0xfa);   // Mach-O 32-bit LE
  } catch (_) {
    return false;
  }
}

function ccusageVersionOf(candidate) {
  const nodeBin = process.env.NODE_BIN || process.execPath;
  const command = candidate.native || candidate.bare ? candidate.file : nodeBin;
  const args = candidate.native || candidate.bare ? ['--version'] : [candidate.file, '--version'];
  try {
    const out = execFileSync(command, args, {
      env: childEnvironment(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return parseVersion(out);
  } catch (_) {
    return null;
  }
}

function resolveCcusageBin({ quiet = false } = {}) {
  const candidates = [];

  const envBin = process.env.CCUSAGE_BIN;
  if (envBin && fs.existsSync(envBin)) {
    candidates.push({ file: envBin, native: isNativeBinary(envBin), bare: false, source: 'CCUSAGE_BIN' });
  }

  const homebrewBin = '/opt/homebrew/bin/ccusage';
  if (fs.existsSync(homebrewBin)) {
    let real = homebrewBin;
    try { real = fs.realpathSync(homebrewBin); } catch (_) { /* keep symlink path */ }
    candidates.push({ file: real, native: isNativeBinary(real), bare: false, source: 'homebrew' });
  }

  candidates.push({ file: 'ccusage', native: false, bare: true, source: 'PATH' });

  let best = null;
  const rejected = [];
  for (const c of candidates) {
    const v = ccusageVersionOf(c);
    const gate = checkVersion(v);
    if (!gate.accepted) {
      rejected.push(`${c.source} (${c.file}): ${gate.reason}`);
      continue;
    }
    if (!best || compareVersions(v, best.v) > 0) best = { ...c, v };
  }
  if (!quiet) for (const reason of rejected) console.error(`  ccusage candidate rejected: ${reason}`);
  if (!best) throw new Error(`No accepted ccusage found. ${checkVersion(null).reason}. Install ccusage@20.0.26 or set CCUSAGE_BIN.`);

  if (!quiet) console.log(`  ccusage: ${best.file} v${best.v.text} (${best.source}${best.native ? ', native' : ''})`);
  return { file: best.file, native: best.native, bare: best.bare };
}

function runCcusageJson(ccusage, args) {
  const nodeBin = process.env.NODE_BIN || process.execPath;
  const direct = ccusage.native || ccusage.bare;
  const command = direct ? ccusage.file : nodeBin;
  // --offline: price from ccusage's embedded table, never a live feed (Anthropic
  // rows are repriced from pricing_snapshots by the database trigger anyway).
  const reportArgs = [...args, '--offline', '--timezone', CCUSAGE_TIMEZONE];
  const commandArgs = direct ? reportArgs : [ccusage.file, ...reportArgs];
  const raw = execFileSync(command, commandArgs, {
    env: childEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

function listAllJsonlFiles(rootDir, cutoffMs) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const p = path.join(rootDir, entry.name);
    if (entry.isDirectory()) files.push(...listAllJsonlFiles(p, cutoffMs));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const stat = fs.statSync(p);
      if (!cutoffMs || stat.mtimeMs >= cutoffMs) files.push(p);
    }
  }
  return files;
}

function claudeSessionIdFromPath(fpath) {
  const base = path.basename(fpath, '.jsonl');
  if (/^[0-9a-f-]{36}$/i.test(base)) return base;
  const parts = fpath.split(path.sep);
  return parts.find((part) => /^[0-9a-f-]{36}$/i.test(part)) ?? null;
}

function readClaudeSessionContext(fpath) {
  const text = fs.readFileSync(fpath, 'utf8');
  const lines = text.split('\n');
  let cwd = null;
  let title = null;
  let firstPrompt = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!cwd && typeof event.cwd === 'string') cwd = event.cwd;
      if (event.type === 'custom-title' && typeof event.customTitle === 'string') {
        title = event.customTitle;
      }
      if (!firstPrompt && event.type === 'user' && event.message) {
        const content = event.message.content;
        if (typeof content === 'string') firstPrompt = content;
        else if (Array.isArray(content)) {
          const part = content.find((item) => item && typeof item.text === 'string');
          if (part) firstPrompt = part.text;
        }
      }
    } catch (_) {}
  }

  const promptTitle = firstPrompt
    ? firstPrompt
        .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)
    : null;

  return { cwd, title: title || promptTitle, sourcePath: fpath };
}

function buildClaudeContextIndex(lookbackDays) {
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const index = new Map();
  for (const fpath of listAllJsonlFiles(CLAUDE_PROJECTS_DIR, cutoffMs)) {
    const sessionId = claudeSessionIdFromPath(fpath);
    if (!sessionId || index.has(sessionId)) continue;
    try {
      const context = readClaudeSessionContext(fpath);
      const attribution = classifyProject(context.cwd, context.title, context.sourcePath);
      if (attribution) index.set(sessionId, attribution);
    } catch (_) {}
  }
  return index;
}

function buildClaudeSessionAttribution(ccusageScript, sinceArg, lookbackDays) {
  const byDateModel = new Map();
  let data;
  try {
    data = runCcusageJson(ccusageScript, ['session', '--json', '--since', sinceArg]);
  } catch (err) {
    console.error(`  ccusage session attribution failed: ${err.message}`);
    return byDateModel;
  }

  const contextBySession = buildClaudeContextIndex(lookbackDays);
  for (const session of data.session ?? []) {
    if (session.agent && session.agent !== 'claude') continue;
    const sessionId = session.period;
    const attribution = contextBySession.get(sessionId);
    if (!attribution) continue;
    const date = (session.metadata?.lastActivity || '').slice(0, 10);
    if (!date) continue;

    for (const m of session.modelBreakdowns ?? []) {
      const modelName = m.modelName;
      if (!modelName || modelName === '<synthetic>') continue;
      const total = (m.inputTokens ?? 0) + (m.outputTokens ?? 0) +
        (m.cacheCreationTokens ?? 0) + (m.cacheReadTokens ?? 0);
      if (total === 0) continue;
      const key = `${date}\x00${modelName}`;
      if (!byDateModel.has(key)) byDateModel.set(key, new Map());
      const projectTotals = byDateModel.get(key);
      projectTotals.set(attribution.slug, (projectTotals.get(attribution.slug) ?? 0) + total);
    }
  }

  return byDateModel;
}

function attributionForClaudeDaily(sessionAttribution, date, modelName) {
  const projectTotals = sessionAttribution.get(`${date}\x00${modelName}`);
  if (!projectTotals || projectTotals.size === 0) return null;
  const entries = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);
  const [slug, tokens] = entries[0];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total || tokens / total < CLAUDE_ATTRIBUTION_MIN_SHARE) return null;
  return project(slug);
}

function isClaudeModel(modelName) {
  return /^claude\b/i.test(modelName);
}

function collectClaudeViaCcusage(workspaceId, userId, lookbackDays) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const sinceDate = since.toISOString().slice(0, 10);
  const sinceArg = sinceDate.replace(/-/g, '');
  const cacheSplit = collectClaudeCacheSplit({ sinceMs: new Date(`${sinceDate}T00:00:00`).getTime(),
    timeZone: CCUSAGE_TIMEZONE });

  const ccusageScript = resolveCcusageBin();
  const sessionAttribution = buildClaudeSessionAttribution(ccusageScript, sinceArg, lookbackDays);
  let data;
  try {
    data = runCcusageJson(ccusageScript, ['daily', '--json', '--since', sinceArg]);
  } catch (err) {
    console.error(`  ccusage CLI failed (script: ${ccusageScript}): ${err.message}`);
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
      if (!modelName || modelName === '<synthetic>' || !isClaudeModel(modelName)) continue;
      const input = m.inputTokens ?? 0;
      const output = m.outputTokens ?? 0;
      const cacheCreate = m.cacheCreationTokens ?? 0;
      const cacheRead = m.cacheReadTokens ?? 0;
      const total = input + output + cacheCreate + cacheRead;
      if (total === 0) continue;
      const capturedAt = new Date(`${date}T00:00:00Z`).toISOString();
      const attribution = attributionForClaudeDaily(sessionAttribution, date, modelName);
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
        project_id: attribution?.id ?? null,
        project_hint: attribution?.slug ?? null,
        input_tokens: input,
        output_tokens: output,
        cache_creation_tokens: cacheCreate,
        cache_creation_1h_tokens: cacheCreation1hForRow(cacheSplit, date, modelName, cacheCreate),
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
