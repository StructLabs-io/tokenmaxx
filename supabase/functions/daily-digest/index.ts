/**
 * daily-digest -- TokenMaxx daily Telegram digest
 *
 * Message structure:
 *   ── Last 24 hours ──
 *   ── Last 7 days ──
 *   ── Last 30 days ──
 *     tokens, event count, MacBook, Server, total, avg/day, delta, window
 *   Quota windows (live observations)
 *   FX rate footer
 *
 * Required Supabase secrets:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for DB queries
 *   TELEGRAM_BOT_TOKEN        - Telegram bot token (format: 12345:AAAA...)
 *   TELEGRAM_CHAT_ID          - Telegram chat/channel ID (e.g. -100123456789)
 *   TELEGRAM_TOPIC_ID         - (optional) Message thread ID for topic groups
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const TELEGRAM_TOPIC_ID = Deno.env.get('TELEGRAM_TOPIC_ID') ?? '';

const MYR_FALLBACK = 4.45;

// --- Format helpers ---

function fmtDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMyr(n: number, rate: number): string {
  return (n * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function blankBar(width: number): string {
  return '[' + ' '.repeat(width) + ']';
}

function fmtSignedPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function classifyWorkspace(name: string): { icon: string; label: string } {
  const lower = name.toLowerCase();
  if (lower.includes('macbook') || lower.includes('mac')) return { icon: '💻', label: 'MacBook' };
  if (lower.includes('server') || lower.includes('openclaw')) return { icon: '🖥', label: 'Server' };
  return { icon: '📟', label: name };
}

// --- Cost/token aggregation helpers ---

type EventRow = {
  date_utc: string;
  provider: string;
  model: string;
  total_tokens: number;
  cost_usd: string | number | null;
  project_id: string | null;
  workspace_id: string | null;
  capture_method: string | null;
  session_id: string | null;
};

/**
 * TokenMaxx events all live under one workspace (per current design), so
 * MacBook vs Server is encoded in the capture_method 4th segment instead:
 *   *.ben_macbook         -> MacBook (current local-capture)
 *   *.openclaw / *.server -> Server (server-capture)
 *   *.personal_dev        -> MacBook (legacy jsonl-walker context)
 */
function sourceFromCaptureMethod(captureMethod: string | null): { icon: string; label: string } {
  if (!captureMethod) return { icon: '📟', label: 'Unknown' };
  const parts = captureMethod.split('.');
  const seg4 = (parts[3] ?? '').toLowerCase();
  if (seg4.includes('mac') || seg4 === 'personal_dev') return { icon: '💻', label: 'MacBook' };
  if (seg4.includes('openclaw') || seg4.includes('server')) return { icon: '🖥', label: 'Server' };
  return { icon: '📟', label: seg4 || 'Unknown' };
}

function sumCost(rows: EventRow[]): number {
  return rows.reduce((s, e) => s + parseFloat(String(e.cost_usd ?? 0)), 0);
}

function sumTokens(rows: EventRow[]): number {
  return rows.reduce((s, e) => s + (e.total_tokens ?? 0), 0);
}

function perSourceCostLines(
  events: EventRow[],
  myrRate: number,
  showMyr = false,
): string[] {
  // Bucket by source (MacBook / Server / ...) derived from capture_method
  const bySource: Record<string, { icon: string; label: string; cost: number }> = {};
  bySource.MacBook = { icon: '💻', label: 'MacBook', cost: 0 };
  bySource.Server = { icon: '🖥', label: 'Server', cost: 0 };
  for (const e of events) {
    const { icon, label } = sourceFromCaptureMethod(e.capture_method);
    if (!bySource[label]) bySource[label] = { icon, label, cost: 0 };
    bySource[label].cost += parseFloat(String(e.cost_usd ?? 0));
  }
  const preferred = ['MacBook', 'Server'];
  const entries = [
    ...preferred.map((label) => bySource[label]),
    ...Object.values(bySource)
      .filter((e) => !preferred.includes(e.label))
      .sort((a, b) => b.cost - a.cost),
  ];

  // Pad colons so $ amounts align: "MacBook: $X", "Server:  $X", "Total:   $X"
  const labels = [...entries.map((e) => e.label), 'Total'];
  const widest = Math.max(...labels.map((l) => l.length));
  const pad = (label: string) => label + ':' + ' '.repeat(widest - label.length + 1);

  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${e.icon} ${pad(e.label)}$${fmtUsd(e.cost)} USD`);
  }
  const total = entries.reduce((s, e) => s + e.cost, 0);
  const myrStr = showMyr ? ` (MYR ${fmtMyr(total, myrRate)})` : '';
  lines.push(`💰 ${pad('Total')}$${fmtUsd(total)} USD${myrStr}`);
  return lines;
}

function periodLines(
  title: string,
  events: EventRow[],
  previousEvents: EventRow[],
  days: number,
  startDate: string,
  endDate: string,
  myrRate: number,
): string[] {
  const cost = sumCost(events);
  const previousCost = sumCost(previousEvents);
  const avgPerDay = cost / days;
  const delta = percentDelta(cost, previousCost);
  const windowText = startDate === endDate ? endDate : `${startDate} – ${endDate}`;

  return [
    title,
    `⚡ ${fmtTokens(sumTokens(events))} tokens | ${events.length.toLocaleString()} events`,
    ...perSourceCostLines(events, myrRate, true),
    `📈 Avg/day: $${fmtUsd(avgPerDay)} USD | Delta: ${fmtSignedPct(delta)}`,
    `Reporting window: ${windowText}`,
  ];
}

function quotaKind(label: string): 'claude' | 'codex' | 'unknown' {
  const lower = label.toLowerCase();
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('codex')) return 'codex';
  return 'unknown';
}

function estimateTokensPerSession(events: EventRow[], label: string): number | null {
  const kind = quotaKind(label);
  if (kind === 'unknown') return null;

  const matching = events.filter((event) => {
    const provider = (event.provider ?? '').toLowerCase();
    const capture = (event.capture_method ?? '').toLowerCase();
    if (kind === 'claude') return provider === 'anthropic' || capture.startsWith('anthropic.');
    return provider === 'openai-codex' || capture.startsWith('openai-codex.');
  });
  if (matching.length === 0) return null;

  const sessionIds = new Set(matching.map((event) => event.session_id).filter(Boolean));
  const divisor = sessionIds.size > 0 ? sessionIds.size : matching.length;
  return Math.round(sumTokens(matching) / divisor);
}

// --- Main handler ---

Deno.serve(async (_req: Request) => {
  try {
    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
    if (missing.length > 0) {
      const msg = `Missing required env vars: ${missing.join(', ')}`;
      console.error(msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Reference date = yesterday in workspace timezone (MYT for Ben).
    // 07:00 MYT cron = 23:00 UTC previous day, so naive UTC math is off by 1.
    const WORKSPACE_TZ = Deno.env.get('DIGEST_TIMEZONE') ?? 'Asia/Kuala_Lumpur';
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: WORKSPACE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const dateStr = addDaysUtc(todayLocal, -1);

    const sevenDayStart = addDaysUtc(dateStr, -6);
    const thirtyDayStart = addDaysUtc(dateStr, -29);
    const sixtyDayStart = addDaysUtc(dateStr, -59);

    // --- Fetch 60d of events (covers current periods + previous-period deltas) ---
    // PostgREST caps at 1000 rows per request — paginate to get every row.
    const allEvents: EventRow[] = [];
    {
      const PAGE = 1000;
      for (let offset = 0; offset < 200_000; offset += PAGE) {
        const { data: page, error: pageErr } = await supabase
          .from('usage_events')
          .select('date_utc, provider, model, total_tokens, cost_usd, project_id, workspace_id, capture_method, session_id')
          .gte('date_utc', sixtyDayStart)
          .lte('date_utc', dateStr)
          .order('date_utc', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (pageErr) throw new Error(`usage_events query: ${pageErr.message}`);
        const rows = (page ?? []) as EventRow[];
        allEvents.push(...rows);
        if (rows.length < PAGE) break;
      }
    }

    // Partition into periods
    const events24h = allEvents.filter((e) => e.date_utc === dateStr);
    const events7d = allEvents.filter((e) => e.date_utc >= sevenDayStart && e.date_utc <= dateStr);
    const events30d = allEvents.filter((e) => e.date_utc >= thirtyDayStart && e.date_utc <= dateStr);

    const previous24hEnd = addDaysUtc(dateStr, -1);
    const previous7dStart = addDaysUtc(sevenDayStart, -7);
    const previous7dEnd = addDaysUtc(sevenDayStart, -1);
    const previous30dStart = addDaysUtc(thirtyDayStart, -30);
    const previous30dEnd = addDaysUtc(thirtyDayStart, -1);
    const previous24hEvents = allEvents.filter((e) => e.date_utc === previous24hEnd);
    const previous7dEvents = allEvents.filter((e) => e.date_utc >= previous7dStart && e.date_utc <= previous7dEnd);
    const previous30dEvents = allEvents.filter((e) => e.date_utc >= previous30dStart && e.date_utc <= previous30dEnd);

    if (events24h.length === 0) {
      // Zero events for the target date is unexpected — Ben uses Claude/Codex daily
      // on at least one host. Throw so the cron is visible as a failure, not a
      // silent green run. This surfaces capture pipeline breaks early.
      const errMsg = `No usage events captured for ${dateStr} — capture pipeline may be broken`;
      console.error(`daily-digest: ${errMsg}`);
      return new Response(JSON.stringify({ error: errMsg, date: dateStr }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate that at least one known host contributed data. If both MacBook
    // and Server show zero tokens, the capture pipeline is broken on all hosts.
    const macEvents = events24h.filter((e) => {
      const { label } = sourceFromCaptureMethod(e.capture_method);
      return label === 'MacBook';
    });
    const serverEvents = events24h.filter((e) => {
      const { label } = sourceFromCaptureMethod(e.capture_method);
      return label === 'Server';
    });
    const macTokens = sumTokens(macEvents);
    const serverTokens = sumTokens(serverEvents);
    if (macTokens === 0 && serverTokens === 0) {
      const errMsg = `Events present for ${dateStr} but all hosts report zero tokens — data integrity issue`;
      console.error(`daily-digest: ${errMsg}`);
      return new Response(JSON.stringify({ error: errMsg, date: dateStr, events: events24h.length }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- MYR rate ---
    const { data: fxRows } = await supabase
      .from('fx_rates')
      .select('usd_to_myr')
      .eq('rate_date', dateStr)
      .limit(1);
    const myrRate: number =
      fxRows && fxRows.length > 0 && fxRows[0].usd_to_myr
        ? parseFloat(fxRows[0].usd_to_myr)
        : MYR_FALLBACK;

    // --- Cost aggregates ---
    const daily24hCost = sumCost(events24h);
    const daily7dCost = sumCost(events7d);
    const daily30dCost = sumCost(events30d);

    // --- Token totals ---
    const tokens24h = sumTokens(events24h);

    // --- Quota windows ---
    const { data: qWindows } = await supabase
      .from('quota_windows')
      .select('id, window_label')
      .eq('active', true)
      .order('id');

    type QuotaObs = {
      percent_used: number | null;
      percent_remaining: number | null;
      absolute_tokens_cap: number | null;
      observed_at: string;
    };
    const quotaLines: string[] = [];
    if (qWindows && qWindows.length > 0) {
      for (const win of qWindows) {
        const { data: obsRows } = await supabase
          .from('quota_observations')
          .select('percent_used, percent_remaining, absolute_tokens_cap, observed_at')
          .eq('quota_window_id', win.id)
          .order('observed_at', { ascending: false })
          .limit(1);
        const obs = obsRows && obsRows.length > 0 ? (obsRows[0] as QuotaObs) : null;
        const remaining = obs?.percent_remaining ?? (
          obs?.percent_used !== null && obs?.percent_used !== undefined
            ? 100 - obs.percent_used
            : null
        );
        const avgTokens = estimateTokensPerSession(events7d, win.window_label);
        const avgText = avgTokens !== null ? fmtTokens(avgTokens) : 'n/a';
        if (remaining !== null) {
          const icon = remaining <= 20 ? '🔴' : remaining <= 40 ? '🟡' : '🟢';
          const capText = obs?.absolute_tokens_cap ? ` | cap: ${fmtTokens(obs.absolute_tokens_cap)}` : '';
          quotaLines.push(
            `${icon} <b>${win.window_label}</b>: ${Number(remaining).toFixed(0)}% remaining ` +
            `<code>${blankBar(10)}</code>`,
          );
          quotaLines.push(`   est. tokens/session: ${avgText}${capText}`);
        } else {
          quotaLines.push(`⚪ <b>${win.window_label}</b>: no observation <code>${blankBar(10)}</code>`);
          quotaLines.push(`   est. tokens/session: ${avgText}`);
        }
      }
    }

    // --- Build message ---
    const lines: string[] = [
      `📊 <b>TokenMaxx — ${fmtDate(dateStr)}</b>`,
      '',
      ...periodLines('── Last 24 hours ──', events24h, previous24hEvents, 1, dateStr, dateStr, myrRate),
      '',
      ...periodLines('── Last 7 days ──', events7d, previous7dEvents, 7, sevenDayStart, dateStr, myrRate),
      '',
      ...periodLines('── Last 30 days ──', events30d, previous30dEvents, 30, thirtyDayStart, dateStr, myrRate),
    ];

    if (quotaLines.length > 0) {
      lines.push('');
      lines.push('Quota windows:');
      lines.push(...quotaLines);
    }

    lines.push('');
    lines.push(`FX rate: 1 USD = ${myrRate.toFixed(4)} MYR`);

    await sendTelegram(lines.join('\n'));

    console.log(
      `daily-digest: sent for ${dateStr} — ${events24h.length} events, ` +
      `$${fmtUsd(daily24hCost)} USD, ${fmtTokens(tokens24h)} tokens`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        date: dateStr,
        events24h: events24h.length,
        tokens24h,
        cost24hUsd: daily24hCost,
        cost7dUsd: daily7dCost,
        cost30dUsd: daily30dCost,
        sentText: lines.join('\n'),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('daily-digest error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
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
  if (!result.ok) throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
}
