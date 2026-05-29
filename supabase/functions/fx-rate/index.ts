/**
 * fx-rate (Edge Function) -- ExchangeRate-API -> Supabase fx_rates
 *
 * Deno port of scripts/fx-rate.js for scheduled execution as a Supabase Edge Function.
 * Fetches daily USD->MYR and USD->SGD rates, skips if today's rate already exists.
 *
 * Required Supabase secrets:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key
 *
 * Schedule: daily at 01:00 UTC (see supabase/migrations/0014_cron_schedules.sql)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const FX_API_URL = 'https://open.exchangerate-api.com/v6/latest/USD';

interface FxRates {
  myr: number;
  sgd: number;
}

async function fetchRates(): Promise<FxRates> {
  const res = await fetch(FX_API_URL);
  if (!res.ok) throw new Error(`ExchangeRate-API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(`ExchangeRate-API result="${data.result}"`);
  const myr: number = data.rates?.MYR;
  const sgd: number = data.rates?.SGD;
  if (myr == null || sgd == null) throw new Error('Missing MYR or SGD in API response');
  return {
    myr: Math.round(myr * 10000) / 10000,
    sgd: Math.round(sgd * 10000) / 10000,
  };
}

Deno.serve(async (_req: Request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const today = new Date().toISOString().slice(0, 10);

    // Dedup check
    const { data: existing } = await supabase
      .from('fx_rates')
      .select('rate_date,usd_to_myr,usd_to_sgd')
      .eq('rate_date', today)
      .limit(1);

    if (existing && existing.length > 0) {
      const row = existing[0];
      console.log(`fx-rate: rate for ${today} already exists (MYR ${row.usd_to_myr}, SGD ${row.usd_to_sgd}) — skipped`);
      return new Response(
        JSON.stringify({ ok: true, date: today, action: 'skipped', existing: row }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { myr, sgd } = await fetchRates();
    console.log(`fx-rate: fetched USD->MYR ${myr}, USD->SGD ${sgd}`);

    const { error } = await supabase.from('fx_rates').insert({
      rate_date: today,
      usd_to_myr: myr,
      usd_to_sgd: sgd,
      source: 'exchangerate-api',
    });

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);

    console.log(`fx-rate: inserted rate for ${today}`);

    return new Response(
      JSON.stringify({ ok: true, date: today, action: 'inserted', usd_to_myr: myr, usd_to_sgd: sgd }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('fx-rate error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
