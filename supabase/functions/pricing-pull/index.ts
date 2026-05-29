/**
 * pricing-pull (Edge Function) -- OpenRouter Model Pricing -> Supabase pricing_snapshots
 *
 * Deno port of scripts/pricing-pull.js for scheduled execution as a Supabase Edge Function.
 * Fetches current model pricing from OpenRouter, compares against the latest snapshot
 * in Supabase, and only inserts a new record when a price changes.
 *
 * Required Supabase secrets:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key
 *
 * Schedule: daily at 02:00 UTC (see supabase/migrations/0014_cron_schedules.sql)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';

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

function orIdToInternal(orId: string): { provider: string; model: string } {
  const [, modelRaw] = orId.split('/');
  const providerRaw = orId.split('/')[0];
  const provider = modelRaw.includes('codex') ? 'openai-codex' : providerRaw;
  // Keep dots in model names — usage_events stores them as-is
  const model = modelRaw;
  return { provider, model };
}

interface PricingEntry {
  inputPerM: number;
  outputPerM: number;
}

async function fetchOpenRouterPricing(): Promise<Record<string, PricingEntry>> {
  const res = await fetch(OPENROUTER_API);
  if (!res.ok) throw new Error(`OpenRouter API: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const models: Array<{
    id: string;
    pricing?: { prompt?: string; completion?: string };
  }> = data.data || [];

  const pricing: Record<string, PricingEntry> = {};
  for (const m of models) {
    if (!TRACKED_OPENROUTER_IDS.includes(m.id)) continue;
    const inputPerM = parseFloat(m.pricing?.prompt ?? '0') * 1_000_000;
    const outputPerM = parseFloat(m.pricing?.completion ?? '0') * 1_000_000;
    pricing[m.id] = {
      inputPerM: Math.round(inputPerM * 10000) / 10000,
      outputPerM: Math.round(outputPerM * 10000) / 10000,
    };
  }
  return pricing;
}

Deno.serve(async (_req: Request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    const pricing = await fetchOpenRouterPricing();
    const found = Object.keys(pricing).length;
    console.log(`pricing-pull: fetched ${found}/${TRACKED_OPENROUTER_IDS.length} tracked models`);

    const stats = { written: 0, skipped: 0, failed: 0 };

    for (const orId of TRACKED_OPENROUTER_IDS) {
      if (!pricing[orId]) {
        console.log(`  ${orId}: not found on OpenRouter — skipped`);
        stats.skipped++;
        continue;
      }

      const { provider, model } = orIdToInternal(orId);
      const current = pricing[orId];

      try {
        // Get last snapshot for this model
        const { data: lastRows } = await supabase
          .from('pricing_snapshots')
          .select('id,input_per_m_usd,output_per_m_usd,effective_date')
          .eq('provider', provider)
          .eq('model', model)
          .order('effective_date', { ascending: false })
          .limit(1);

        const last = lastRows && lastRows.length > 0 ? lastRows[0] : null;

        if (last) {
          const lastInput = parseFloat(last.input_per_m_usd);
          const lastOutput = parseFloat(last.output_per_m_usd);
          if (lastInput === current.inputPerM && lastOutput === current.outputPerM) {
            console.log(`  ${orId}: no change — skipped`);
            stats.skipped++;
            continue;
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

        const { error } = await supabase
          .from('pricing_snapshots')
          .insert(row)
          .throwOnError();

        if (error) throw error;

        const action = last ? 'CHANGE recorded' : 'initial snapshot';
        console.log(`  ${orId}: ${action} ($${current.inputPerM}/$${current.outputPerM})`);
        stats.written++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${orId}: FAILED — ${msg}`);
        stats.failed++;
      }
    }

    console.log(`pricing-pull done: ${stats.written} written, ${stats.skipped} skipped, ${stats.failed} failed`);

    return new Response(JSON.stringify({ ok: true, date: today, ...stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('pricing-pull error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
