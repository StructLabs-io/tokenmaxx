'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { childEnvironment } = require('./ccusage-version.cjs');
const { readCodexSessionMeta } = require('./codex-session.cjs');

function runCcusageCodexSessions({ command, args = [], env = process.env }) {
  return JSON.parse(execFileSync(command, [...args, 'codex', 'session', '--json', '--offline'], {
    env: childEnvironment(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000, maxBuffer: 64 * 1024 * 1024,
  }));
}

function codexSessionsDirs(env = process.env) {
  const home = env.HOME || os.homedir();
  return (env.CODEX_HOME || path.join(home, '.codex')).split(',').map(dir => dir.trim())
    .filter(Boolean).flatMap(dir => {
      const root = dir.replace(/^~(?=\/|$)/, home);
      return [path.join(root, 'sessions'), path.join(root, 'archived_sessions')];
    });
}

// The array carries a missing-file count so callers can report skipped sessions.
function codexRecordsFromCcusage(json, { sessionsDirs = codexSessionsDirs(), cutoffMs = 0,
  readMeta = readCodexSessionMeta } = {}) {
  if (!json || !Array.isArray(json.sessions)) throw new Error('Invalid ccusage Codex sessions JSON');
  const records = [];
  records.skippedMissingFiles = 0;
  for (const session of json.sessions) {
    if (!session || typeof session.sessionId !== 'string' || !session.models ||
        typeof session.models !== 'object' || Array.isArray(session.models)) {
      throw new Error('Invalid ccusage Codex session');
    }
    const relative = session.sessionId.endsWith('.jsonl') ? session.sessionId : `${session.sessionId}.jsonl`;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
      throw new Error('Invalid ccusage Codex session path');
    }
    let sourcePath, stat;
    for (const dir of sessionsDirs) {
      const candidate = path.join(dir, relative);
      try {
        const candidateStat = fs.statSync(candidate);
        if (candidateStat.isFile()) { sourcePath = candidate; stat = candidateStat; break; }
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      }
    }
    if (!sourcePath) { records.skippedMissingFiles++; continue; }
    if (stat.mtimeMs < cutoffMs) continue;
    const meta = readMeta(sourcePath);
    const sessionId = path.basename(sourcePath, '.jsonl')
      .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1] || meta.id;
    if (!sessionId) throw new Error('Codex session has no rollout UUID or metadata id');
    for (const [model, usage] of Object.entries(session.models)) {
      if (!usage || typeof usage !== 'object') throw new Error('Invalid ccusage Codex model usage');
      const tokens = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']
        .map(key => usage[key] ?? 0);
      if (tokens.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid ccusage Codex tokens');
      if (tokens.every(value => value === 0)) continue;
      const [inputTokens, outputTokens, cachedTokens, cacheCreationTokens] = tokens;
      records.push({ ts: new Date(meta.timestamp || stat.mtimeMs).toISOString(), model,
        inputTokens, outputTokens, cachedTokens, cacheCreationTokens, sessionId,
        sourcePath, cwd: meta.cwd, title: meta.title });
    }
  }
  return records;
}

module.exports = { runCcusageCodexSessions, codexRecordsFromCcusage, codexSessionsDirs };
