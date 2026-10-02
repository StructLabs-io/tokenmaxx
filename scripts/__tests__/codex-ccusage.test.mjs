import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { codexRecordsFromCcusage, codexSessionsDirs } = require('../lib/codex-ccusage.cjs');
const { readCodexSessionMeta } = require('../lib/codex-session.cjs');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/codex-ccusage.json', import.meta.url)));
const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenmaxx-fixture-')); dirs.push(dir);
  const sessionsDirs = [path.join(dir, 'sessions'), path.join(dir, 'archived_sessions')];
  fixture.sessions.slice(0, 3).forEach((session, i) => {
    const file = path.join(sessionsDirs[i === 1 ? 1 : 0], `${session.sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(new URL('./fixtures/codex-meta.jsonl', import.meta.url), file);
    const date = new Date(i === 2 ? '2026-09-01' : '2026-09-30');
    fs.utimesSync(file, date, date);
  });
  return sessionsDirs;
}
it('emits per-model ccusage counts, resolves archives, filters mtime, counts missing files and keeps child UUIDs', () => {
  const readMeta = vi.fn(readCodexSessionMeta);
  const records = codexRecordsFromCcusage(fixture, { sessionsDirs: setup(), cutoffMs: Date.parse('2026-09-28'), readMeta });
  expect(records).toHaveLength(3);
  expect(records.skippedMissingFiles).toBe(1);
  expect(readMeta).toHaveBeenCalledTimes(2);
  expect(records[0]).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedTokens: 80, cacheCreationTokens: 10,
    model: 'fixture-model-a', sessionId: '00000000-0000-4000-8000-000000000001',
    ts: '2026-09-14T11:11:40.000Z', cwd: '/fictional/project', title: 'Fixture task title' });
  expect(records.slice(1).map(row => row.model)).toEqual(['fixture-model-a', 'fixture-model-b']);
  expect(records[1].sessionId).toBe('00000000-0000-4000-8000-000000000002');
  expect(records[1].cacheCreationTokens).toBe(0);
});
it('falls back to metadata ID and mtime when filename UUID and timestamp are absent', () => {
  const sessionsDirs = setup();
  fs.copyFileSync(path.join(sessionsDirs[0], `${fixture.sessions[0].sessionId}.jsonl`), path.join(sessionsDirs[0], 'rollout-fixture.jsonl'));
  const file = path.join(sessionsDirs[0], 'rollout-fixture.jsonl');
  fs.utimesSync(file, new Date('2026-09-30'), new Date('2026-09-30'));
  const records = codexRecordsFromCcusage({ sessions: [{ ...fixture.sessions[0], sessionId: 'rollout-fixture' }] }, {
    sessionsDirs, readMeta: () => ({ id: 'invented-fallback', cwd: null, title: null }),
  });
  expect(records[0].sessionId).toBe('invented-fallback');
  expect(records[0].ts).toBe(fs.statSync(file).mtime.toISOString());
});
it('rejects invalid structures, traversal and invalid counts', () => {
  const sessionsDirs = setup();
  for (const json of [null, {}, { sessions: [null] }, { sessions: [{ sessionId: '../escape', models: {} }] },
    { sessions: [{ ...fixture.sessions[0], models: { bad: { inputTokens: '100' } } }] }]) {
    expect(() => codexRecordsFromCcusage(json, { sessionsDirs })).toThrow();
  }
});
it('resolves multiple Codex homes including archived sessions', () => {
  expect(codexSessionsDirs({ HOME: '/fictional/home', CODEX_HOME: '~/one, /fictional/two' })).toEqual([
    '/fictional/home/one/sessions', '/fictional/home/one/archived_sessions', '/fictional/two/sessions', '/fictional/two/archived_sessions',
  ]);
  expect(codexSessionsDirs({ HOME: '/fictional/home' })[0]).toBe('/fictional/home/.codex/sessions');
});
it.each([undefined, '/fictional/one,/fictional/two'])('executes offline without a date bound and isolates child env (%s)', codeHome => {
  const child = vi.fn(() => JSON.stringify(fixture));
  const filename = new URL('../lib/codex-ccusage.cjs', import.meta.url);
  const realRequire = createRequire(filename);
  const context = { module: { exports: {} }, require: id => id === 'child_process' ? { execFileSync: child } : realRequire(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const env = { HOME: '/fictional/home', PATH: '/fictional/bin', SUPABASE_URL: 'fake', SUPABASE_SERVICE_ROLE_KEY: 'fake', ...(codeHome ? { CODEX_HOME: codeHome } : {}) };
  expect(context.module.exports.runCcusageCodexSessions({ command: 'fixture-command', args: ['fixture-prefix'], env })).toEqual(fixture);
  expect(child.mock.calls[0][1]).toEqual(['fixture-prefix', 'codex', 'session', '--json', '--offline']);
  expect(child.mock.calls[0][2].env).toEqual({ HOME: '/fictional/home', PATH: '/fictional/bin', ...(codeHome ? { CODEX_HOME: codeHome } : {}) });
  child.mockReturnValue('invalid JSON');
  expect(() => context.module.exports.runCcusageCodexSessions({ command: 'fixture-command', env })).toThrow();
});
