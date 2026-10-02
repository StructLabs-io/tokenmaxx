import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const version = require('../lib/ccusage-version.cjs');

function loadCapture(name, extraEnv = {}) {
  const filename = new URL(`../${name}-capture.js`, import.meta.url);
  const realRequire = createRequire(filename);
  const env = { HOME: '/fictional/home', PATH: '/fictional/bin', TZ: 'UTC', LANG: 'en_US',
    CCUSAGE_BIN: '/fictional/ccusage', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'invented-secret', ...extraEnv };
  const daily = { daily: [{ date: '2026-09-29', modelBreakdowns: [{ modelName: 'claude-opus-5', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 100, cacheReadTokens: 30 }] }] };
  const child = vi.fn((command, args) => {
    if (args.includes('--version')) return args.includes('/fictional/ccusage') ? '20.0.27' : command === 'ccusage' ? '20.0.26' : command === 'npx' ? '20.0.26' : '20.1.0';
    return JSON.stringify(args.includes('session') ? { session: [] } : daily);
  });
  const codexRun = vi.fn(() => ({ sessions: [] }));
  const codexRecords = vi.fn(() => Object.assign([], { skippedMissingFiles: 2 }));
  const split = vi.fn(() => new Map([['2026-09-29\0claude-opus-5', { cacheCreation: 100, cacheCreation1h: 70 }]]));
  const writes = [];
  const existing = [];
  const fetch = vi.fn(async (url, options) => {
    if (options.method === 'POST') writes.push(...JSON.parse(options.body));
    return { ok: true, text: async () => options.method === 'GET' ? JSON.stringify(existing) : '' };
  });
  const fakeFs = { existsSync: () => true, realpathSync: file => file, openSync: () => 1,
    readSync: () => 0, closeSync: () => {}, readdirSync: () => [] };
  const log = vi.fn();
  const context = { module: { exports: {} }, console: { log, warn: log, error: log }, Buffer, URLSearchParams, fetch,
    process: { env, argv: [], execPath: '/fictional/node' },
    require: id => {
      if (id === 'fs') return fakeFs;
      if (id === 'child_process') return { execFileSync: child };
      if (id === './lib/codex-ccusage.cjs') return { ...realRequire(id), runCcusageCodexSessions: codexRun, codexRecordsFromCcusage: codexRecords };
      if (id === './lib/ccusage-version.cjs') return { ...version, checkVersion: v => version.checkVersion(v, env), childEnvironment: () => version.childEnvironment(env) };
      if (id === './lib/claude-cache-split.cjs') return {
        collectClaudeCacheSplit: split,
        cacheCreation1hForRow: realRequire(id).cacheCreation1hForRow,
      };
      return realRequire(id);
    } };
  const source = fs.readFileSync(filename, 'utf8');
  // Omit CLI startup; all external effects above are injected fakes.
  vm.runInNewContext(source.slice(0, source.lastIndexOf('\nmain().catch')) + '\nmodule.exports = { collectClaudeViaCcusage, collectCodexViaCcusage, batchInsertEvents };', context);
  return { ...context.module.exports, child, writes, existing, fetch, log, codexRun, codexRecords, split };
}
for (const name of ['local', 'server']) {
  it(`${name}: ccusage is version-gated, isolated, and gets 1h split`, () => {
    const capture = loadCapture(name);
    const rows = capture.collectClaudeViaCcusage('invented-workspace', 'invented-user', 7);
    expect(rows[0].cache_creation_1h_tokens).toBe(70);
    expect(capture.split.mock.calls[0][0].timeZone).toBe('UTC');
    const dailyArgs = capture.child.mock.calls.find(([, args]) => args.includes('daily'))[1];
    expect(dailyArgs[dailyArgs.indexOf('--timezone') + 1]).toBe('UTC');
    for (const [, , options] of capture.child.mock.calls) {
      expect(Object.keys(options.env).sort()).toEqual(['HOME', 'LANG', 'PATH', 'TZ']);
    }
    if (name === 'server') {
      expect(capture.child.mock.calls[0][1]).toEqual(['--yes', 'ccusage@20.0.26', '--version']);
      expect(capture.child.mock.calls[1][1].slice(0, 3)).toEqual(['--yes', 'ccusage@20.0.26', 'daily']);
    } else {
      expect(capture.child.mock.calls.at(-1)[1][0]).toBe('/fictional/ccusage');
      expect(capture.log.mock.calls.some(([line]) => line.includes('candidate rejected'))).toBe(true);
    }
  });
  it(`${name}: rejects unapproved ccusage before collecting daily`, () => {
    const capture = loadCapture(name);
    capture.child.mockReturnValue('20.1.0');
    expect(() => capture.collectClaudeViaCcusage('invented-workspace', 'invented-user', 7)).toThrow('No accepted ccusage');
    expect(capture.child.mock.calls.every(([, args]) => args.includes('--version'))).toBe(true);
  });
  it(`${name}: dedupes, applies date and shrink guards, preserves attribution`, async () => {
    const capture = loadCapture(name, { TOKENMAXX_MIN_DATE: '2026-09-28' });
    const base = { user_id: 'invented-user', capture_method: 'fixture.cli', session_id: 'invented-session',
      model: 'fixture-model', date_utc: '2026-09-29', input_tokens: 100, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0,
      project_id: null, project_hint: null };
    capture.existing.push({ ...base, session_id: 'shrinking', input_tokens: 1000 });
    const result = await capture.batchInsertEvents([base, { ...base, input_tokens: 200 },
      { ...base, session_id: 'shrinking' }, { ...base, date_utc: '2026-09-27' },
      { ...base, session_id: 'labelled', project_id: 'invented-project' }], false);
    expect(result).toEqual({ inserted: 2, failed: 0 });
    expect(capture.writes.find(row => row.session_id === 'invented-session').input_tokens).toBe(200);
    for (const row of capture.writes) {
      expect(row.project_id).not.toBeNull(); expect(row.project_hint).toBeUndefined();
    }
    expect(capture.fetch.mock.calls[0][1].method).toBe('GET');
  });
}

for (const name of ['local', 'server']) {
  it(`${name}: gates Codex, forwards configured homes and counts missing sessions`, () => {
    const key = name === 'local' ? 'CODEX_HOME' : 'TOKENMAXX_CODEX_HOME';
    const capture = loadCapture(name, { [key]: '/fictional/one,/fictional/two' });
    capture.collectCodexViaCcusage(123);
    const call = capture.codexRun.mock.calls[0][0];
    expect(call.env.CODEX_HOME).toBe('/fictional/one,/fictional/two');
    expect(Object.keys(call.env).some(key => key.startsWith('SUPABASE_'))).toBe(false);
    expect(capture.child.mock.calls.every(([, args]) => args.includes('--version'))).toBe(true);
    expect(capture.codexRecords.mock.calls[0][1]).toEqual({ cutoffMs: 123, sessionsDirs: [
      '/fictional/one/sessions', '/fictional/one/archived_sessions', '/fictional/two/sessions', '/fictional/two/archived_sessions',
    ] });
    expect(capture.log.mock.calls.some(([line]) => line.includes('missing files: 2'))).toBe(true);
    if (name === 'server') expect(call.args).toEqual(['--yes', 'ccusage@20.0.26']);
    else expect(call.args).toEqual(['/fictional/ccusage']);
  });
  it(`${name}: omits CODEX_HOME when unset`, () => {
    const capture = loadCapture(name);
    capture.collectCodexViaCcusage(0);
    expect(capture.codexRun.mock.calls[0][0].env).not.toHaveProperty('CODEX_HOME');
  });
  it.each(['version', 'command', 'json'])(`${name}: fails closed with one error on %s failure`, kind => {
    const capture = loadCapture(name);
    if (kind === 'version') capture.child.mockReturnValue('20.1.0');
    else (kind === 'command' ? capture.codexRun : capture.codexRecords).mockImplementation(() => { throw new Error('fixture failure\nextra line'); });
    expect(capture.collectCodexViaCcusage(0)).toEqual([]);
    expect(capture.writes).toHaveLength(0);
    expect(capture.log).toHaveBeenCalledTimes(1);
    expect(capture.log.mock.calls[0][0]).toContain('Codex ccusage failed');
    expect(capture.log.mock.calls[0][0]).not.toContain('\n');
    if (kind === 'version') expect(capture.codexRun).not.toHaveBeenCalled();
  });
}

for (const name of ['local', 'server']) {
  it(`${name}: uses the same non-UTC timezone for ccusage and cache writes`, () => {
    const capture = loadCapture(name, { TZ: 'America/Los_Angeles' });
    capture.collectClaudeViaCcusage('invented-workspace', 'invented-user', 7);
    const args = capture.child.mock.calls.find(([, args]) => args.includes('daily'))[1];
    expect(args[args.indexOf('--timezone') + 1]).toBe('America/Los_Angeles');
    expect(capture.split.mock.calls[0][0].timeZone).toBe('America/Los_Angeles');
  });
}
