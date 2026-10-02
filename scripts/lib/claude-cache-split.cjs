'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultProjectsDirs(env = process.env) {
  const home = env.HOME || os.homedir();
  const dirs = env.CLAUDE_CONFIG_DIR
    ? env.CLAUDE_CONFIG_DIR.split(',').map(dir => {
      dir = dir.trim().replace(/^~/, home);
      return fs.existsSync(path.join(dir, 'projects')) ? path.join(dir, 'projects') : dir;
    })
    : [path.join(home, '.config/claude/projects'), path.join(home, '.claude/projects')];
  return dirs.filter(dir => dir && fs.existsSync(dir));
}
function collectClaudeCacheSplit({ projectsDirs = defaultProjectsDirs(), sinceMs = 0,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const groups = new Map();
  const stack = [...projectsDirs];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(file); continue; }
      if (!entry.isFile() || !file.endsWith('.jsonl') || fs.statSync(file).mtimeMs < sinceMs - 86400000) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('usage')) continue;
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }
        const message = event.message;
        if (event.type !== 'assistant' || !message?.usage || message.model === '<synthetic>') continue;
        const key = event.requestId || (message.id && `msg:${message.id}`);
        const timestamp = Date.parse(event.timestamp);
        if (!key || !Number.isFinite(timestamp)) continue;
        const usage = message.usage;
        const group = groups.get(key) || { timestamp, model: message.model, cacheCreation: 0, cacheCreation1h: 0 };
        group.timestamp = Math.min(group.timestamp, timestamp);
        group.cacheCreation = Math.max(group.cacheCreation, usage.cache_creation_input_tokens || 0);
        group.cacheCreation1h = Math.max(group.cacheCreation1h, usage.cache_creation?.ephemeral_1h_input_tokens || 0);
        groups.set(key, group);
      }
    }
  }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const result = new Map();
  for (const group of groups.values()) {
    if (group.timestamp < sinceMs) continue;
    const parts = Object.fromEntries(formatter.formatToParts(group.timestamp).map(p => [p.type, p.value]));
    const key = `${parts.year}-${parts.month}-${parts.day}\u0000${group.model}`;
    const row = result.get(key) || { cacheCreation: 0, cacheCreation1h: 0, requests: 0 };
    row.cacheCreation += group.cacheCreation;
    row.cacheCreation1h += group.cacheCreation1h;
    row.requests++;
    result.set(key, row);
  }
  return result;
}
function cacheCreation1hForRow(split, date, model, cacheCreation, warn = console.warn) {
  const row = split.get(`${date}\u0000${model}`);
  if (Math.abs((row?.cacheCreation || 0) - cacheCreation) > cacheCreation * 0.02) {
    warn(`  WARN Claude cache writes differ >2% for ${date} ${model}: transcripts=${row?.cacheCreation || 0}, ccusage=${cacheCreation}`);
  }
  return Math.min(row?.cacheCreation1h || 0, cacheCreation);
}
module.exports = { defaultProjectsDirs, collectClaudeCacheSplit, cacheCreation1hForRow };
