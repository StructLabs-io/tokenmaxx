#!/usr/bin/env node
/**
 * fx-rate.js -- ExchangeRate-API -> Supabase fx_rates
 *
 * Fetches daily USD->MYR and USD->SGD exchange rates and writes them to
 * the fx_rates table. Skips if today's rate already exists.
 *
 * Usage:
 *   node fx-rate.js
 *   node fx-rate.js --date 2026-03-01
 *   node fx-rate.js --help
 *
 * Environment:
 *   SUPABASE_URL              Required
 *   SUPABASE_SERVICE_ROLE_KEY Required
 */

'use strict';

const FX_API_URL = 'https://open.exchangerate-api.com/v6/latest/USD';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function findExistingRate(date) {
  const rows = await supabaseRequest(
    `fx_rates?select=rate_date,usd_to_myr,usd_to_sgd&rate_date=eq.${date}&limit=1`
  );
  return (rows && rows.length > 0) ? rows[0] : null;
}

// --- FX API ---

async function fetchRates() {
  const res = await fetch(FX_API_URL);
  if (!res.ok) throw new Error(`ExchangeRate-API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(`ExchangeRate-API result="${data.result}"`);
  const myr = data.rates?.MYR;
  const sgd = data.rates?.SGD;
  if (myr == null || sgd == null) throw new Error(`Missing MYR or SGD in API response`);
  return {
    myr: Math.round(myr * 10000) / 10000,
    sgd: Math.round(sgd * 10000) / 10000,
  };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
fx-rate.js -- ExchangeRate-API -> Supabase fx_rates

Fetches daily USD->MYR and USD->SGD exchange rates.
Skips if the date already exists.

Usage:
  node fx-rate.js
  node fx-rate.js --date 2026-03-01
  node fx-rate.js --help

Options:
  --date YYYY-MM-DD    Override the rate date (default: today)
  --help, -h           Show this help message

Environment:
  SUPABASE_URL              Required
  SUPABASE_SERVICE_ROLE_KEY Required
`);
    process.exit(0);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
    process.exit(1);
  }

  // Determine target date
  const dateIdx = args.indexOf('--date');
  let targetDate;
  if (dateIdx !== -1 && args[dateIdx + 1]) {
    targetDate = args[dateIdx + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      console.error(`Error: Invalid date format "${targetDate}". Use YYYY-MM-DD.`);
      process.exit(1);
    }
  } else {
    targetDate = new Date().toISOString().slice(0, 10);
  }

  console.log(`fx-rate.js -- ExchangeRate-API -> Supabase fx_rates`);
  console.log(`Date: ${targetDate}\n`);

  // Dedup check
  console.log('Checking for existing rate...');
  const existing = await findExistingRate(targetDate);
  if (existing) {
    console.log(`Rate for ${targetDate} already exists — skipping.`);
    console.log(`  USD->MYR: ${existing.usd_to_myr}`);
    console.log(`  USD->SGD: ${existing.usd_to_sgd}`);
    process.exit(0);
  }

  console.log('Fetching rates from ExchangeRate-API...');
  const { myr, sgd } = await fetchRates();
  console.log(`  USD->MYR: ${myr}`);
  console.log(`  USD->SGD: ${sgd}`);

  console.log('Writing to Supabase...');
  const row = {
    rate_date: targetDate,
    usd_to_myr: myr,
    usd_to_sgd: sgd,
    source: 'exchangerate-api',
  };
  await supabaseRequest('fx_rates', 'POST', row, {
    Prefer: 'resolution=ignore-duplicates,return=representation',
  });
  console.log(`Inserted rate for ${targetDate}.`);
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
