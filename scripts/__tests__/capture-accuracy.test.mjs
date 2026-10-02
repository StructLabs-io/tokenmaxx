import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseVersion, compareVersions, checkVersion, childEnvironment } = require('../lib/ccusage-version.cjs');
const { collectClaudeCacheSplit, cacheCreation1hForRow, defaultProjectsDirs } = require('../lib/claude-cache-split.cjs');
const { filterMinDate, shouldSkipShrink, fetchExistingRows, guardUpsertRows } = require('../lib/upsert-guard.cjs');
const { freshnessDecision, main, newestFileMtime } = require('../capture-freshness.js');
const { createSupabaseRequest } = require('../lib/supabase-rest.cjs');
const temporary = [];
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmaxx-fixture-')); temporary.push(dir); return dir; }
function write(dir, name, events) {
  const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n')); return file;
}
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('ccusage gate and secret isolation', () => {
  it('parses and compares numeric versions', () => {
    expect(parseVersion('ccusage v20.0.26\n').text).toBe('20.0.26');
    expect(parseVersion('unknown')).toBeNull();
    expect(compareVersions('20.0.100', '20.0.26')).toBeGreaterThan(0);
    expect(compareVersions('20.0.26', '20.0.26')).toBe(0);
  });
  it.each([['20.0.25', false], ['20.0.26', true], ['20.1.0', false]])('gates %s', (version, accepted) => {
    expect(checkVersion(version, {}).accepted).toBe(accepted);
  });
  it('supports explicit bounds and explains rejection', () => {
    expect(checkVersion('21.0.0', { TOKENMAXX_CCUSAGE_MIN_VERSION: '21.0.0', TOKENMAXX_CCUSAGE_MAX_VERSION_EXCLUSIVE: '22.0.0' }).accepted).toBe(true);
    expect(checkVersion(null, {}).reason).toContain('unreadable');
  });
  it('only forwards allowed environment variables', () => {
    expect(childEnvironment({ PATH: '/fictional/bin', HOME: '/fictional/home', TZ: 'UTC', LANG: 'en_US', CLAUDE_CONFIG_DIR: '/fictional/config', SUPABASE_SERVICE_ROLE_KEY: 'fake', OTHER_SECRET: 'fake' }))
      .toEqual({ PATH: '/fictional/bin', HOME: '/fictional/home', TZ: 'UTC', LANG: 'en_US', CLAUDE_CONFIG_DIR: '/fictional/config' });
  });
});
function assistant(requestId, count, hour, extra = {}) {
  return { type: 'assistant', timestamp: '2026-09-29T00:30:00Z', requestId,
    message: { id: `invented-${requestId}`, model: 'claude-opus-5', usage: { cache_creation_input_tokens: count, cache_creation: { ephemeral_1h_input_tokens: hour } } }, ...extra };
}
describe('Claude cache split', () => {
  it('deduplicates streams and copied requests globally, includes subagents and nested null model', () => {
    const dir = temp(); const streamed = [assistant('stream', 100, 20), assistant('stream', 200, 80), assistant('stream', 300, 100)];
    streamed[0].timestamp = '2026-09-28T23:30:00Z';
    const synthetic = assistant('ignored', 1000, 1000); synthetic.message.model = '<synthetic>';
    const nested = assistant('nested', 50, 50); nested.message.iterations = [{ model: null }];
    write(dir, 'project/session.jsonl', [...streamed, synthetic, nested]);
    write(dir, 'project/session/subagents/agent-x.jsonl', [assistant('subagent', 60, 0)]);
    write(dir, 'project/copy.jsonl', [streamed[2]]);
    const result = collectClaudeCacheSplit({ projectsDirs: [dir], sinceMs: Date.parse('2026-09-28'), timeZone: 'UTC' });
    expect(result.get('2026-09-28\0claude-opus-5')).toEqual({ cacheCreation: 300, cacheCreation1h: 100, requests: 1 });
    expect(result.get('2026-09-29\0claude-opus-5')).toEqual({ cacheCreation: 110, cacheCreation1h: 50, requests: 2 });
    const local = collectClaudeCacheSplit({ projectsDirs: [dir], timeZone: 'America/Los_Angeles' });
    expect(local.get('2026-09-28\0claude-opus-5')).toEqual({ cacheCreation: 410, cacheCreation1h: 150, requests: 3 });
  });
  it('uses message id fallback, skips missing IDs, old timestamps and old files', () => {
    const dir = temp(); const fallback = assistant('fallback', 20, 10); delete fallback.requestId;
    const missing = assistant('missing', 100, 0); delete missing.requestId; delete missing.message.id;
    const old = assistant('old', 100, 0); old.timestamp = '2020-01-01';
    write(dir, 'current.jsonl', [fallback, fallback, missing, old]);
    const stale = write(dir, 'stale.jsonl', [assistant('stale-file', 100, 0)]); fs.utimesSync(stale, new Date('2020-01-01'), new Date('2020-01-01'));
    expect([...collectClaudeCacheSplit({ projectsDirs: [dir], sinceMs: Date.parse('2026-09-28'), timeZone: 'UTC' }).values()])
      .toEqual([{ cacheCreation: 20, cacheCreation1h: 10, requests: 1 }]);
  });
  it('resolves config roots and projects directories', () => {
    const dir = temp(); fs.mkdirSync(path.join(dir, 'a/projects'), { recursive: true }); fs.mkdirSync(path.join(dir, 'b'));
    expect(defaultProjectsDirs({ CLAUDE_CONFIG_DIR: `${dir}/a, ${dir}/b` })).toEqual([`${dir}/a/projects`, `${dir}/b`]);
  });
  it('clamps hour writes and warns only above 2%', () => {
    const warn = vi.fn(); const split = new Map([['day\0model', { cacheCreation: 102, cacheCreation1h: 120 }]]);
    expect(cacheCreation1hForRow(split, 'day', 'model', 100, warn)).toBe(100); expect(warn).not.toHaveBeenCalled();
    cacheCreation1hForRow(split, 'day', 'model', 90, warn); expect(warn).toHaveBeenCalledTimes(1);
    expect(cacheCreation1hForRow(new Map(), 'day', 'model', 0, warn)).toBe(0);
  });
});
const row = { user_id: 'invented-user', capture_method: 'fixture.cli', session_id: 'invented-session', model: 'fixture-model', date_utc: '2026-09-28', input_tokens: 1000, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 };
describe('history guard', () => {
  it('filters minimum date inclusively', () => {
    expect(filterMinDate([row, { ...row, date_utc: '2026-09-27' }], '2026-09-28')).toEqual([row]);
    expect(() => filterMinDate([row], 'bad')).toThrow();
  });
  it.each([[995, false], [994, true], [1000, false], [1200, false]])('checks boundary at %i', (tokens, skip) => {
    expect(shouldSkipShrink({ ...row, input_tokens: tokens }, row)).toBe(skip);
  });
  it('allows overrides and new keys', async () => {
    expect(shouldSkipShrink({ ...row, input_tokens: 0 }, row, true)).toBe(false);
    expect(shouldSkipShrink(row, undefined)).toBe(false);
    const request = vi.fn(); expect(await guardUpsertRows([row], request, { allowShrink: true })).toEqual([row]); expect(request).not.toHaveBeenCalled();
  });
  it('fetches all pages, scoped by user and methods', async () => {
    const request = vi.fn().mockResolvedValueOnce(Array.from({ length: 1000 }, () => row)).mockResolvedValueOnce([row]);
    expect(await fetchExistingRows([row], request)).toHaveLength(1001);
    const params = new URLSearchParams(request.mock.calls[1][0].split('?')[1]);
    expect(params.get('offset')).toBe('1000'); expect(params.get('user_id')).toBe('eq.invented-user');
    expect(params.get('date_utc')).toBe('gte.2026-09-28'); expect(params.get('capture_method')).toContain('fixture.cli');
  });
  it('scopes every page to each user and their batch methods', async () => {
    const other = { ...row, user_id: 'invented-other', capture_method: 'fixture.other' };
    const request = vi.fn().mockResolvedValueOnce(Array(1000).fill(row)).mockResolvedValueOnce([]).mockResolvedValueOnce([other]);
    await fetchExistingRows([row, { ...row, capture_method: 'fixture.second' }, other], request);
    const queries = request.mock.calls.map(([url]) => new URLSearchParams(url.split('?')[1]));
    expect(queries.map(q => q.get('user_id'))).toEqual(['eq.invented-user', 'eq.invented-user', 'eq.invented-other']);
    expect(queries.map(q => q.get('offset'))).toEqual(['0', '1000', '0']);
    expect(queries[0].get('capture_method')).toBe('in.("fixture.cli","fixture.second")');
    expect(queries[1].get('capture_method')).toBe(queries[0].get('capture_method'));
    expect(queries[2].get('capture_method')).toBe('in.("fixture.other")');
  });
  it('skips shrinking keys, passes new keys and emits one summary', async () => {
    const log = vi.fn(); const newRow = { ...row, session_id: 'invented-new', input_tokens: 1 };
    expect(await guardUpsertRows([{ ...row, input_tokens: 10 }, newRow], async () => [row], { log })).toEqual([newRow]);
    expect(log).toHaveBeenCalledTimes(1); expect(log.mock.calls[0][0]).toContain('skipped 1');
  });
  it('fails closed when fetching stored history fails', async () => {
    await expect(guardUpsertRows([row], async () => { throw new Error('fake offline'); })).rejects.toThrow('fake offline');
  });
});
describe('freshness', () => {
  const hour = 3600000;
  it.each([[30, 2, 'STALE'], [26, 2, 'FRESH'], [30, 1, 'IDLE'], [30, 0, 'IDLE']])('age %i activity delta %i', (age, activity, status) => {
    expect(freshnessDecision({ now: 100 * hour, newestIngest: (100 - age) * hour, newestActivity: (100 - age + activity) * hour })).toBe(status);
  });
  it('handles absent ingestion or activity', () => {
    expect(freshnessDecision({ now: 100 * hour, newestIngest: null, newestActivity: null })).toBe('IDLE');
    expect(freshnessDecision({ now: 100 * hour, newestIngest: null, newestActivity: hour })).toBe('STALE');
  });
  it('reads newest recursive file mtime and ignores missing directories', () => {
    const dir = temp(); const file = write(dir, 'nested/activity.jsonl', []); fs.utimesSync(file, new Date('2026-01-01'), new Date('2026-01-01'));
    expect(newestFileMtime([dir, `${dir}/missing`])).toBe(Date.parse('2026-01-01'));
  });
  it('runs with injected REST and activity fakes', async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: 'invented-user' }]).mockResolvedValueOnce([{ ingested_at: '2026-09-28T00:00:00Z' }]);
    const log = vi.fn();
    expect(await main(['--user-slug', 'fixture'], { request, now: Date.parse('2026-09-30'), activity: () => Date.parse('2026-09-29'), log })).toBe(1);
    expect(log.mock.calls[0][0]).toContain('STALE'); expect(request.mock.calls[1][0]).toContain('order=ingested_at.desc.nullslast&limit=1');
  });
  it('help needs no credentials and errors reject', async () => {
    expect(await main(['--help'], { env: {}, log: vi.fn() })).toBe(0);
    await expect(main([], { env: {} })).rejects.toThrow('user slug');
  });
  it('REST helper supports injected fetch without network', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const request = createSupabaseRequest({ url: 'https://fixture.invalid', key: 'invented-key', fetchImpl });
    expect(await request('users')).toEqual([]); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
