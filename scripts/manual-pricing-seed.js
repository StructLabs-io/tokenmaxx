#!/usr/bin/env node
/**
 * manual-pricing-seed.js -- Static pricing seed for models not on OpenRouter
 *
 * Seeds pricing_snapshots for:
 *   - anthropic/claude-haiku-4-5-20251001 (dated variant of haiku-4.5)
 *   - openai-codex/gpt-5-codex-spark      (unknown variant — use gpt-5 pricing)
 *   - openai-codex/codex-unknown          (unidentified model — use gpt-5 pricing)
 *
 * Prices sourced from ECIS MODEL_PRICING table + OpenRouter cross-reference.
 * Update STATIC_PRICES when official pricing is published.
 *
 * Usage:
 *   node manual-pricing-seed.js
 *   node manual-pricing-seed.js --dry-run
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 */

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Static prices (per 1M tokens, USD).
// source field = 'manual' per schema convention.
const STATIC_PRICES = [
  // claude-haiku-4-5-20251001: same pricing as haiku-4.5 (dated variant)
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    input_per_m_usd: 1.00,
    output_per_m_usd: 5.00,
    source: 'manual',
    notes: 'Dated variant of claude-haiku-4.5. Pricing matches base model.',
  },
  // gpt-5.3-codex-spark: spark variant, assumed same tier as gpt-5.3-codex
  {
    provider: 'openai-codex',
    model: 'gpt-5.3-codex-spark',
    input_per_m_usd: 1.75,
    output_per_m_usd: 14.00,
    source: 'manual',
    notes: 'Spark variant of gpt-5.3-codex. Assumed same pricing tier.',
  },
  // codex-unknown: unidentified Codex model, using gpt-5 conservative estimate
  {
    provider: 'openai-codex',
    model: 'codex-unknown',
    input_per_m_usd: 1.25,
    output_per_m_usd: 10.00,
    source: 'manual',
    notes: 'Unidentified Codex model. Using gpt-5 conservative pricing estimate.',
  },
];

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
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getLastSnapshot(provider, model) {
  const query = `pricing_snapshots?select=id,input_per_m_usd,output_per_m_usd,effective_date` +
    `&provider=eq.${encodeURIComponent(provider)}` +
    `&model=eq.${encodeURIComponent(model)}` +
    `&order=effective_date.desc&limit=1`;
  const rows = await supabaseRequest(query);
  return (rows && rows.length > 0) ? rows[0] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`manual-pricing-seed.js -- static seed for ${STATIC_PRICES.length} models${dryRun ? ' [DRY RUN]' : ''}\n`);

  let written = 0, skipped = 0, failed = 0;

  for (const price of STATIC_PRICES) {
    const { provider, model, input_per_m_usd, output_per_m_usd, source, notes } = price;

    try {
      const last = await getLastSnapshot(provider, model);

      if (last) {
        const lastInput = parseFloat(last.input_per_m_usd);
        const lastOutput = parseFloat(last.output_per_m_usd);
        if (lastInput === input_per_m_usd && lastOutput === output_per_m_usd) {
          console.log(`  ${provider}/${model}: no change — skipped`);
          skipped++;
          continue;
        }
      }

      const row = { provider, model, effective_date: today, input_per_m_usd, output_per_m_usd, source };

      if (dryRun) {
        console.log(`  ${provider}/${model}: would insert $${input_per_m_usd}/$${output_per_m_usd} [${notes}]`);
        written++;
        continue;
      }

      await supabaseRequest('pricing_snapshots', 'POST', row, {
        Prefer: 'resolution=ignore-duplicates,return=representation',
      });
      const action = last ? 'updated' : 'inserted';
      console.log(`  ${provider}/${model}: ${action} ($${input_per_m_usd}/$${output_per_m_usd})`);
      written++;
    } catch (err) {
      console.error(`  ${provider}/${model}: FAILED — ${err.message}`);
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
