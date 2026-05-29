#!/usr/bin/env node
/**
 * pricing-pull.js -- OpenRouter Model Pricing -> Supabase pricing_snapshots (delta-based)
 *
 * Fetches current model pricing from OpenRouter, compares against the latest
 * snapshot in Supabase, and only inserts a new record when a price changes.
 * Uses ON CONFLICT DO NOTHING so duplicate-date runs are idempotent.
 *
 * Usage:
 *   node pricing-pull.js
 *   node pricing-pull.js --dry-run
 *   node pricing-pull.js --help
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 */

'use strict';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// OpenRouter IDs -> our internal (provider, model) mapping.
// Derive automatically: split on '/', replace '.' with '-' in model part.
// e.g. 'anthropic/claude-sonnet-4.6' -> provider='anthropic', model='claude-sonnet-4-6'
const TRACKED_OPENROUTER_IDS = [
  'anthropic/claude-opus-4.7',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5',
  'openai/gpt-5-codex',
  'openai/gpt-5.1',
  'openai/gpt-5.1-codex-mini',
  'openai/gpt-5.2',
  'openai/gpt-5.3-codex',
  'openai/gpt-5.4',
  'openai/gpt-5.4-mini',
  'openai/gpt-5.5',
];

function orIdToInternal(orId) {
  const [providerRaw, modelRaw] = orId.split('/');
  // OpenRouter uses 'openai' for both regular OpenAI and Codex.
  // We store Codex-flavoured models under 'openai-codex'.
  const provider = modelRaw.includes('codex') ? 'openai-codex' : providerRaw;
  // IMPORTANT: keep dots in model names — usage_events stores them as-is
  // (e.g. 'gpt-5.3-codex', not 'gpt-5-3-codex').
  // Only strip the provider prefix; do NOT replace dots with dashes.
  const model = modelRaw;
  return { provider, model };
}

// --- Supabase REST helper ---

async function supabaseRequest(path, method = 'GET', body = null, extraHeaders = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
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
    throw new Error(`Supabase ${method} ${path}: ${res.status} ${text}`);
  }
  // 204 No Content returns empty body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- OpenRouter ---

async function fetchOpenRouterPricing() {
  console.log('Fetching model pricing from OpenRouter...');
  const res = await fetch(OPENROUTER_API);
  if (!res.ok) throw new Error(`OpenRouter API: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const models = data.data || [];

  const pricing = {};
  for (const m of models) {
    if (!TRACKED_OPENROUTER_IDS.includes(m.id)) continue;
    const inputPerM = parseFloat(m.pricing?.prompt || 0) * 1_000_000;
    const outputPerM = parseFloat(m.pricing?.completion || 0) * 1_000_000;
    pricing[m.id] = {
      inputPerM: Math.round(inputPerM * 10000) / 10000,
      outputPerM: Math.round(outputPerM * 10000) / 10000,
    };
  }

  const found = Object.keys(pricing).length;
  console.log(`  Found pricing for ${found}/${TRACKED_OPENROUTER_IDS.length} tracked models`);
  const missing = TRACKED_OPENROUTER_IDS.filter(id => !pricing[id]);
  if (missing.length > 0) console.log(`  Missing on OpenRouter: ${missing.join(', ')}`);
  return pricing;
}

// --- Supabase: last snapshot for a (provider, model) ---

async function getLastSnapshot(provider, model) {
  const query = `pricing_snapshots?select=id,input_per_m_usd,output_per_m_usd,effective_date` +
    `&provider=eq.${encodeURIComponent(provider)}` +
    `&model=eq.${encodeURIComponent(model)}` +
    `&order=effective_date.desc&limit=1`;
  const rows = await supabaseRequest(query);
  return (rows && rows.length > 0) ? rows[0] : null;
}

// --- Insert snapshot ---

async function insertSnapshot(row) {
  // ON CONFLICT (provider, model, effective_date) DO NOTHING
  return supabaseRequest('pricing_snapshots', 'POST', row, {
    Prefer: 'resolution=ignore-duplicates,return=representation',
  });
}

// --- Process one model ---

async function processModel(orId, current, dryRun) {
  const { provider, model } = orIdToInternal(orId);
  const today = new Date().toISOString().slice(0, 10);

  const last = await getLastSnapshot(provider, model);

  if (last) {
    const lastInput = parseFloat(last.input_per_m_usd);
    const lastOutput = parseFloat(last.output_per_m_usd);
    if (lastInput === current.inputPerM && lastOutput === current.outputPerM) {
      console.log(`  ${orId} (${provider}/${model}): no change ($${current.inputPerM}/$${current.outputPerM} per M) — skipped`);
      return 'skipped';
    }
    const avgOld = (lastInput + lastOutput) / 2;
    const avgNew = (current.inputPerM + current.outputPerM) / 2;
    const deltaPct = avgOld > 0 ? Math.round(((avgNew - avgOld) / avgOld) * 10000) / 100 : 0;
    if (dryRun) {
      console.log(`  ${orId}: CHANGE detected (delta ${deltaPct}%) — dry run, not writing`);
      return 'dry-run';
    }
  } else {
    if (dryRun) {
      console.log(`  ${orId}: NEW model — dry run, not writing ($${current.inputPerM}/$${current.outputPerM})`);
      return 'dry-run';
    }
  }

  const row = {
    provider,
    model,
    effective_date: today,
    input_per_m_usd: current.inputPerM,
    output_per_m_usd: current.outputPerM,
    source: 'openrouter',
  };
  await insertSnapshot(row);
  const action = last ? 'CHANGE recorded' : 'initial snapshot recorded';
  console.log(`  ${orId} (${provider}/${model}): ${action} ($${current.inputPerM}/$${current.outputPerM})`);
  return 'written';
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
pricing-pull.js -- OpenRouter Model Pricing -> Supabase pricing_snapshots (delta-based)

Usage:
  node pricing-pull.js
  node pricing-pull.js --dry-run
  node pricing-pull.js --help

Options:
  --dry-run    Fetch and compare but do not write to Supabase
  --help, -h   Show this help message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required

Tracked OpenRouter IDs:
${TRACKED_OPENROUTER_IDS.map(id => '  ' + id).join('\n')}
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  console.log(`pricing-pull.js -- OpenRouter -> Supabase pricing_snapshots${dryRun ? ' [DRY RUN]' : ''}\n`);

  const pricing = await fetchOpenRouterPricing();

  let written = 0, skipped = 0, failed = 0;

  console.log('\nComparing against last Supabase snapshots...');
  for (const orId of TRACKED_OPENROUTER_IDS) {
    if (!pricing[orId]) {
      console.log(`  ${orId}: not found on OpenRouter — skipped`);
      skipped++;
      continue;
    }
    try {
      const result = await processModel(orId, pricing[orId], dryRun);
      if (result === 'written' || result === 'dry-run') written++;
      else skipped++;
    } catch (err) {
      console.error(`  ${orId}: FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${written} written/dry-run, ${skipped} skipped, ${failed} failed`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
