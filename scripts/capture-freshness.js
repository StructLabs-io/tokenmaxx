#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSupabaseRequest } = require('./lib/supabase-rest.cjs');
const HOUR = 3600000;
function freshnessDecision({ now, newestIngest, newestActivity, maxAgeHours = 26 }) {
  const ingest = newestIngest ?? -Infinity;
  if (now - ingest <= maxAgeHours * HOUR) return 'FRESH';
  return newestActivity != null && newestActivity > ingest + HOUR ? 'STALE' : 'IDLE';
}
function newestFileMtime(dirs) {
  let newest = null;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const time = entry.isDirectory() ? newestFileMtime([file]) : entry.isFile() ? fs.statSync(file).mtimeMs : null;
      if (time != null) newest = newest == null ? time : Math.max(newest, time);
    }
  }
  return newest;
}
async function main(args = process.argv.slice(2), { env = process.env, request, now = Date.now(), activity = newestFileMtime, log = console.log } = {}) {
  if (args.includes('--help') || args.includes('-h')) {
    log('Usage: node scripts/capture-freshness.js --user-slug <slug> [--max-age-hours 26] [--activity-dir <dir> ...]');
    return 0;
  }
  let slug, maxAgeHours = 26;
  const dirs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--user-slug', '--max-age-hours', '--activity-dir'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${arg}`);
    const value = args[++i];
    if (arg === '--user-slug') slug = value;
    else if (arg === '--max-age-hours') maxAgeHours = Number(value);
    else dirs.push(value.replace(/^~/, env.HOME || os.homedir()));
  }
  if (!slug || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('A user slug and positive max-age-hours are required');
  request ||= createSupabaseRequest({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
  const users = await request(`users?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  if (!users?.[0]?.id) throw new Error(`User not found: ${slug}`);
  const events = await request(`usage_events?select=ingested_at&user_id=eq.${encodeURIComponent(users[0].id)}&order=ingested_at.desc.nullslast&limit=1`);
  const newestIngest = events?.[0]?.ingested_at ? Date.parse(events[0].ingested_at) : null;
  if (newestIngest != null && !Number.isFinite(newestIngest)) throw new Error('Invalid ingestion timestamp');
  const home = env.HOME || os.homedir();
  const newestActivity = activity(dirs.length ? dirs : [path.join(home, '.claude/projects'), path.join(home, '.codex/sessions')]);
  const status = freshnessDecision({ now, newestIngest, newestActivity, maxAgeHours });
  log(`TokenMaxx capture ${status}: ${slug}; newest ingest ${newestIngest == null ? 'none' : new Date(newestIngest).toISOString()}`);
  return status === 'STALE' ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`TokenMaxx freshness check failed: ${error.message.replace(/\s+/g, ' ')}`);
  process.exitCode = 2;
});
module.exports = { freshnessDecision, newestFileMtime, main };
