'use strict';

function parseVersion(output) {
  const match = String(output).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: +match[1], minor: +match[2], patch: +match[3], text: match[0] } : null;
}
function compareVersions(a, b) {
  if (typeof a === 'string') a = parseVersion(a);
  if (typeof b === 'string') b = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}
function checkVersion(version, env = process.env) {
  const min = env.TOKENMAXX_CCUSAGE_MIN_VERSION || '20.0.26';
  const max = env.TOKENMAXX_CCUSAGE_MAX_VERSION_EXCLUSIVE || '20.1.0';
  if (!parseVersion(min) || !parseVersion(max)) throw new Error('Invalid ccusage version bounds');
  const parsed = typeof version === 'string' ? parseVersion(version) : version;
  const accepted = !!parsed && compareVersions(parsed, min) >= 0 && compareVersions(parsed, max) < 0;
  return { accepted, reason: accepted ? null : `requires >= ${min} and < ${max}; got ${parsed?.text || 'unreadable version'}` };
}
function childEnvironment(env = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'TZ', 'LANG', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
}
module.exports = { parseVersion, compareVersions, checkVersion, childEnvironment };
