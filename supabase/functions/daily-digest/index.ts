/**
 * daily-digest -- Tokenmaxx daily Telegram digest
 *
 * Queries yesterday's usage_events, groups by model + provider,
 * formats a Telegram message and posts it via Bot API.
 *
 * Required Supabase secrets (set via Dashboard or Management API):
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for DB queries
 *   TELEGRAM_BOT_TOKEN        - Telegram bot token (format: 12345:AAAA...)
 *   TELEGRAM_CHAT_ID          - Telegram chat/channel ID (e.g. -100123456789)
 *   TELEGRAM_TOPIC_ID         - (optional) Message thread ID for topic groups
 *
 * Invoke:
 *   POST https://<project>.supabase.co/functions/v1/daily-digest
 *   Authorization: Bearer <SERVICE_ROLE_KEY>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const TELEGRAM_TOPIC_ID = Deno.env.get('TELEGRAM_TOPIC_ID') ?? '';

// MYR conversion rate fallback — overridden by fx_rates table when available
const MYR_FALLBACK = 4.45;

Deno.serve(async (_req: Request) => {
  try {
    // Validate required env vars
    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
    if (missing.length > 0) {
      const msg = `Missing required env vars: ${missing.join(', ')}`;
      console.error(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Yesterday in UTC
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD

    // --- Query usage_events for yesterday ---
    const { data: events, error: eventsError } = await supabase
      .from('usage_events')
      .select('provider, model, total_tokens, cost_usd')
      .eq('date_utc', dateStr);

    if (eventsError) {
      throw new Error(`usage_events query failed: ${eventsError.message}`);
    }

    if (!events || events.length === 0) {
      // No events — send a quiet "no activity" digest
      const text = `📊 <b>Tokenmaxx — ${dateStr}</b>\n\nNo usage captured for this date.`;
      await sendTelegram(text);
      return new Response(JSON.stringify({ ok: true, date: dateStr, events: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- Try to get MYR rate for yesterday ---
    const { data: fxRows } = await supabase
      .from('fx_rates')
      .select('usd_to_myr')
      .eq('rate_date', dateStr)
      .limit(1);

    const myrRate: number =
      (fxRows && fxRows.length > 0 && fxRows[0].usd_to_myr)
        ? parseFloat(fxRows[0].usd_to_myr)
        : MYR_FALLBACK;

    // --- Aggregate by provider + model ---
    type ModelStat = { tokens: number; cost: number };
    const byModel: Record<string, ModelStat> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const row of events) {
      const key = `${row.provider}/${row.model}`;
      if (!byModel[key]) byModel[key] = { tokens: 0, cost: 0 };
      byModel[key].tokens += row.total_tokens ?? 0;
      byModel[key].cost += parseFloat(row.cost_usd ?? 0);
      totalTokens += row.total_tokens ?? 0;
      totalCost += parseFloat(row.cost_usd ?? 0);
    }

    // Sort by token count descending
    const sorted = Object.entries(byModel).sort((a, b) => b[1].tokens - a[1].tokens);

    // --- Format numbers ---
    function fmtTokens(n: number): string {
      if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
      return String(n);
    }

    function fmtUsd(n: number): string {
      return n.toFixed(2);
    }

    function fmtMyr(n: number): string {
      return (n * myrRate).toFixed(2);
    }

    // --- Build Telegram message (HTML) ---
    const modelLines = sorted
      .slice(0, 10) // cap at 10 rows so message stays readable
      .map(([key, stat]) => {
        const modelName = key.split('/')[1] ?? key;
        return `• <code>${modelName}</code>: ${fmtTokens(stat.tokens)} tokens ($${fmtUsd(stat.cost)})`;
      })
      .join('\n');

    const text = [
      `📊 <b>Tokenmaxx — ${dateStr}</b>`,
      '',
      `Tokens: <b>${fmtTokens(totalTokens)}</b> total`,
      `Cost: <b>$${fmtUsd(totalCost)} USD</b> (MYR${fmtMyr(totalCost)})`,
      '',
      'Top models:',
      modelLines,
      '',
      `Events: <b>${events.length.toLocaleString()}</b> captured`,
    ].join('\n');

    await sendTelegram(text);

    console.log(`daily-digest: sent for ${dateStr} — ${events.length} events, $${fmtUsd(totalCost)} USD`);

    return new Response(
      JSON.stringify({
        ok: true,
        date: dateStr,
        events: events.length,
        totalTokens,
        totalCostUsd: totalCost,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('daily-digest error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// --- Telegram helper ---

async function sendTelegram(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
  };
  if (TELEGRAM_TOPIC_ID) {
    body.message_thread_id = parseInt(TELEGRAM_TOPIC_ID, 10);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${detail}`);
  }

  const result = await res.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }
}
