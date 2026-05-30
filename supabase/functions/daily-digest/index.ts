/**
 * daily-digest -- Tokenmaxx daily Telegram digest
 *
 * Queries yesterday's usage_events, groups by model + provider,
 * formats a Telegram message (ECIS-style) and posts it via Bot API.
 *
 * Message structure mirrors ECIS Daily Spend format:
 *   - Header: date + token total
 *   - Cost: total USD + MYR, 7d avg, delta %, 30d total
 *   - Quota: per-window % used (Claude + Codex windows)
 *   - Models: top-10 breakdown by token usage
 *   - Projects: top-5 breakdown by token usage
 *   - Footer: log entry count + FX rate used
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

// --- Format helpers ---

function fmtDate(dateStr: string): string {
  // "2026-05-29" -> "29 May 2026"
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateStr}T00:00:00Z`));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return n.toFixed(2);
}

function fmtMyr(n: number, rate: number): string {
  return (n * rate).toFixed(2);
}

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

    const sevenDayStart = addDaysUtc(dateStr, -6);   // 7-day window inclusive
    const thirtyDayStart = addDaysUtc(dateStr, -29); // 30-day window inclusive

    // --- Query usage_events for the 30-day window (covers yesterday + 7d avg + 30d total) ---
    const { data: events30d, error: eventsError } = await supabase
      .from('usage_events')
      .select('date_utc, provider, model, total_tokens, cost_usd, project_id')
      .gte('date_utc', thirtyDayStart)
      .lte('date_utc', dateStr);

    if (eventsError) {
      throw new Error(`usage_events query failed: ${eventsError.message}`);
    }

    const allEvents = events30d ?? [];

    // Partition events
    const todayEvents = allEvents.filter((e) => e.date_utc === dateStr);
    const sevenDayEvents = allEvents.filter(
      (e) => e.date_utc >= sevenDayStart && e.date_utc <= dateStr
    );

    if (todayEvents.length === 0) {
      // No events — send a quiet "no activity" digest
      const text = `📊 <b>Tokenmaxx — ${fmtDate(dateStr)}</b>\n\nNo usage captured for this date.`;
      await sendTelegram(text);
      return new Response(JSON.stringify({ ok: true, date: dateStr, events: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- MYR rate for yesterday ---
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
    const sumCost = (rows: typeof allEvents) =>
      rows.reduce((s, e) => s + (parseFloat(String(e.cost_usd ?? 0))), 0);
    const sumTokens = (rows: typeof allEvents) =>
      rows.reduce((s, e) => s + (e.total_tokens ?? 0), 0);

    const dailyTotal = sumCost(todayEvents);
    const dailyTokens = sumTokens(todayEvents);
    const sevenDayTotal = sumCost(sevenDayEvents);
    const sevenDayAvg = sevenDayTotal / 7;
    const deltaPct = sevenDayAvg > 0 ? ((dailyTotal - sevenDayAvg) / sevenDayAvg) * 100 : 0;
    const thirtyDayTotal = sumCost(allEvents);

    // --- Per-model breakdown (yesterday) ---
    type ModelStat = { tokens: number; cost: number };
    const byModel: Record<string, ModelStat> = {};
    for (const row of todayEvents) {
      const key = `${row.provider}/${row.model}`;
      if (!byModel[key]) byModel[key] = { tokens: 0, cost: 0 };
      byModel[key].tokens += row.total_tokens ?? 0;
      byModel[key].cost += parseFloat(String(row.cost_usd ?? 0));
    }
    const sortedModels = Object.entries(byModel).sort((a, b) => b[1].tokens - a[1].tokens);

    // --- Per-project breakdown (yesterday, top 5) ---
    const projectIds = [...new Set(todayEvents.map((e) => e.project_id).filter(Boolean))];
    const byProject: Record<string, { tokens: number; cost: number }> = {};
    for (const row of todayEvents) {
      if (!row.project_id) continue;
      if (!byProject[row.project_id]) byProject[row.project_id] = { tokens: 0, cost: 0 };
      byProject[row.project_id].tokens += row.total_tokens ?? 0;
      byProject[row.project_id].cost += parseFloat(String(row.cost_usd ?? 0));
    }

    // Fetch project display names
    let projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, display_name, slug')
        .in('id', projectIds);
      if (projRows) {
        for (const p of projRows) {
          projectNames[p.id] = p.display_name ?? p.slug ?? p.id;
        }
      }
    }

    const sortedProjects = Object.entries(byProject)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5);

    // --- Latest quota observations per window ---
    const { data: qWindows } = await supabase
      .from('quota_windows')
      .select('id, window_label, window_type, window_hours')
      .eq('active', true)
      .order('id');

    type QuotaObs = {
      quota_window_id: number;
      percent_used: number | null;
      observed_at: string;
    };

    const quotaLines: string[] = [];
    if (qWindows && qWindows.length > 0) {
      for (const win of qWindows) {
        const { data: obsRows } = await supabase
          .from('quota_observations')
          .select('percent_used, observed_at')
          .eq('quota_window_id', win.id)
          .order('observed_at', { ascending: false })
          .limit(1);

        const obs = obsRows && obsRows.length > 0 ? obsRows[0] as QuotaObs : null;
        const pct = obs?.percent_used != null ? obs.percent_used : null;

        if (pct !== null) {
          const bar = buildBar(pct, 10);
          const icon = pct >= 80 ? '🔴' : pct >= 60 ? '🟡' : '🟢';
          quotaLines.push(`${icon} <b>${win.window_label}</b>: ${pct}% used  ${bar}`);
        } else {
          quotaLines.push(`⚪ <b>${win.window_label}</b>: no observation`);
        }
      }
    }

    // --- Build message ---
    const deltaSign = deltaPct >= 0 ? '+' : '';
    const modelLines = sortedModels
      .slice(0, 10)
      .map(([key, stat]) => {
        const modelName = key.split('/')[1] ?? key;
        return `  • <code>${modelName}</code>: ${fmtTokens(stat.tokens)} tkns ($${fmtUsd(stat.cost)})`;
      })
      .join('\n');

    const projectSection =
      sortedProjects.length > 0
        ? sortedProjects
            .map(([pid, stat]) => {
              const name = projectNames[pid] ?? pid.slice(0, 12);
              return `  • <code>${name}</code>: ${fmtTokens(stat.tokens)} tkns ($${fmtUsd(stat.cost)})`;
            })
            .join('\n')
        : '  (no project attribution)';

    const lines: string[] = [
      `📊 <b>Tokenmaxx — ${fmtDate(dateStr)}</b>`,
      `⚡ ${fmtTokens(dailyTokens)} tokens | ${todayEvents.length.toLocaleString()} log entries`,
      '',
      `💰 Cost:  $${fmtUsd(dailyTotal)} USD (MYR ${fmtMyr(dailyTotal, myrRate)})`,
      `📈 7d avg: $${fmtUsd(sevenDayAvg)} USD | Delta: ${deltaSign}${deltaPct.toFixed(1)}%`,
      '',
    ];

    if (quotaLines.length > 0) {
      lines.push('Quota windows:');
      lines.push(...quotaLines);
      lines.push('');
    }

    lines.push('Top models:');
    lines.push(modelLines);
    lines.push('');
    lines.push('Top projects:');
    lines.push(projectSection);
    lines.push('');
    lines.push('──');
    lines.push(`📅 30d Total: $${fmtUsd(thirtyDayTotal)} USD (MYR ${fmtMyr(thirtyDayTotal, myrRate)})`);
    lines.push(`Reporting window: ${thirtyDayStart} – ${dateStr}`);
    lines.push(`FX rate: 1 USD = ${myrRate.toFixed(4)} MYR`);

    const text = lines.join('\n');

    await sendTelegram(text);

    console.log(
      `daily-digest: sent for ${dateStr} — ${todayEvents.length} events, ` +
      `$${fmtUsd(dailyTotal)} USD, ${fmtTokens(dailyTokens)} tokens`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        date: dateStr,
        events: todayEvents.length,
        totalTokens: dailyTokens,
        totalCostUsd: dailyTotal,
        sevenDayAvgUsd: sevenDayAvg,
        thirtyDayTotalUsd: thirtyDayTotal,
        deltaPct,
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

// --- Progress bar helper ---

function buildBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

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
