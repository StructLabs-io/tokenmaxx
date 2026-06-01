/**
 * daily-digest -- Tokenmaxx daily Telegram digest
 *
 * Message structure:
 *   ── Last 24 hours ──  (yesterday)
 *     per-workspace costs + total (USD + MYR)
 *     token count + log entries
 *   ── Last 7 days ──
 *     per-workspace costs + total (USD + MYR)
 *     avg/day, delta vs 30d avg
 *     top models (7d rolling)
 *     top projects (7d rolling)
 *   ── Last 30 days ──
 *     per-workspace costs + total (USD + MYR)
 *     reporting window
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
};

function sumCost(rows: EventRow[]): number {
  return rows.reduce((s, e) => s + parseFloat(String(e.cost_usd ?? 0)), 0);
}

function sumTokens(rows: EventRow[]): number {
  return rows.reduce((s, e) => s + (e.total_tokens ?? 0), 0);
}

function perWorkspaceCostLines(
  events: EventRow[],
  wsNames: Record<string, string>,
  myrRate: number,
  showMyr = false,
): string[] {
  const byWs: Record<string, number> = {};
  for (const e of events) {
    const key = e.workspace_id ?? '__unknown__';
    byWs[key] = (byWs[key] ?? 0) + parseFloat(String(e.cost_usd ?? 0));
  }
  // Build label/cost rows, sorted by cost desc
  const entries = Object.entries(byWs)
    .map(([wsId, cost]) => {
      const name = wsNames[wsId] ?? wsId.slice(0, 12);
      const { icon, label } = classifyWorkspace(name);
      return { icon, label, cost };
    })
    .sort((a, b) => b.cost - a.cost);

  // Pad colons so the $ amounts line up: longest label gets one trailing space,
  // shorter labels get more.
  const labels = [...entries.map((e) => e.label), 'Total'];
  const widest = Math.max(...labels.map((l) => l.length));
  const pad = (label: string) => label + ':' + ' '.repeat(widest - label.length + 1);

  const lines: string[] = [];
  for (const e of entries) {
    lines.push(`${e.icon} ${pad(e.label)}$${fmtUsd(e.cost)} USD`);
  }
  const total = Object.values(byWs).reduce((s, c) => s + c, 0);
  const myrStr = showMyr ? ` (MYR ${fmtMyr(total, myrRate)})` : '';
  lines.push(`💰 ${pad('Total')}$${fmtUsd(total)} USD${myrStr}`);
  return lines;
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

    // --- Fetch 30d of events (covers all 3 periods) ---
    // PostgREST caps at 1000 rows per request — paginate to get every row.
    const allEvents: EventRow[] = [];
    {
      const PAGE = 1000;
      for (let offset = 0; offset < 200_000; offset += PAGE) {
        const { data: page, error: pageErr } = await supabase
          .from('usage_events')
          .select('date_utc, provider, model, total_tokens, cost_usd, project_id, workspace_id')
          .gte('date_utc', thirtyDayStart)
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

    if (events24h.length === 0) {
      const text = `📊 <b>Tokenmaxx — ${fmtDate(dateStr)}</b>\n\nNo usage captured for this date.`;
      await sendTelegram(text);
      return new Response(JSON.stringify({ ok: true, date: dateStr, events: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
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

    // --- Workspace display names ---
    const workspaceIds = [...new Set(allEvents.map((e) => e.workspace_id).filter(Boolean))] as string[];
    const wsNames: Record<string, string> = {};
    if (workspaceIds.length > 0) {
      const { data: wsRows } = await supabase
        .from('workspaces')
        .select('id, display_name, slug')
        .in('id', workspaceIds);
      if (wsRows) {
        for (const w of wsRows) wsNames[w.id] = w.display_name ?? w.slug ?? w.id;
      }
    }

    // --- Cost aggregates ---
    const daily24hCost = sumCost(events24h);
    const daily7dCost = sumCost(events7d);
    const daily30dCost = sumCost(allEvents);
    const sevenDayAvg = daily7dCost / 7;
    const thirtyDayAvg = daily30dCost / 30;
    const deltaPct = thirtyDayAvg > 0
      ? ((sevenDayAvg - thirtyDayAvg) / thirtyDayAvg) * 100
      : 0;

    // --- Token totals ---
    const tokens24h = sumTokens(events24h);

    // --- Top models (7d) ---
    type Stat = { tokens: number; cost: number };
    const byModel7d: Record<string, Stat> = {};
    for (const row of events7d) {
      const key = row.model;
      if (!byModel7d[key]) byModel7d[key] = { tokens: 0, cost: 0 };
      byModel7d[key].tokens += row.total_tokens ?? 0;
      byModel7d[key].cost += parseFloat(String(row.cost_usd ?? 0));
    }
    const sortedModels = Object.entries(byModel7d)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 10);

    // --- Top projects (7d) ---
    const projectIds7d = [...new Set(events7d.map((e) => e.project_id).filter(Boolean))] as string[];
    const byProject7d: Record<string, Stat> = {};
    for (const row of events7d) {
      if (!row.project_id) continue;
      if (!byProject7d[row.project_id]) byProject7d[row.project_id] = { tokens: 0, cost: 0 };
      byProject7d[row.project_id].tokens += row.total_tokens ?? 0;
      byProject7d[row.project_id].cost += parseFloat(String(row.cost_usd ?? 0));
    }
    const projectNames: Record<string, string> = {};
    if (projectIds7d.length > 0) {
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, display_name, slug')
        .in('id', projectIds7d);
      if (projRows) {
        for (const p of projRows) projectNames[p.id] = p.display_name ?? p.slug ?? p.id;
      }
    }
    const sortedProjects = Object.entries(byProject7d)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5);

    // --- Quota windows ---
    const { data: qWindows } = await supabase
      .from('quota_windows')
      .select('id, window_label')
      .eq('active', true)
      .order('id');

    type QuotaObs = { percent_used: number | null; observed_at: string };
    const quotaLines: string[] = [];
    if (qWindows && qWindows.length > 0) {
      for (const win of qWindows) {
        const { data: obsRows } = await supabase
          .from('quota_observations')
          .select('percent_used, observed_at')
          .eq('quota_window_id', win.id)
          .order('observed_at', { ascending: false })
          .limit(1);
        const obs = obsRows && obsRows.length > 0 ? (obsRows[0] as QuotaObs) : null;
        const pct = obs?.percent_used ?? null;
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

    const lines: string[] = [
      `📊 <b>Tokenmaxx — ${fmtDate(dateStr)}</b>`,
      '',
      '── Last 24 hours ──',
      `⚡ ${fmtTokens(tokens24h)} tokens | ${events24h.length.toLocaleString()} events`,
      ...perWorkspaceCostLines(events24h, wsNames, myrRate, true),
      '',
      '── Last 7 days ──',
      ...perWorkspaceCostLines(events7d, wsNames, myrRate, true),
      `📈 Avg/day: $${fmtUsd(sevenDayAvg)} USD | Delta vs 30d: ${deltaSign}${deltaPct.toFixed(1)}%`,
    ];

    if (sortedModels.length > 0) {
      lines.push('');
      lines.push('Top models (7d):');
      for (const [model, stat] of sortedModels) {
        lines.push(`  • <code>${model}</code>: ${fmtTokens(stat.tokens)} tkns ($${fmtUsd(stat.cost)})`);
      }
    }

    if (sortedProjects.length > 0) {
      lines.push('');
      lines.push('Top projects (7d):');
      for (const [pid, stat] of sortedProjects) {
        const name = projectNames[pid] ?? pid.slice(0, 12);
        lines.push(`  • <code>${name}</code>: ${fmtTokens(stat.tokens)} tkns ($${fmtUsd(stat.cost)})`);
      }
    }

    lines.push('');
    lines.push('── Last 30 days ──');
    lines.push(...perWorkspaceCostLines(allEvents, wsNames, myrRate, true));
    lines.push(`Reporting window: ${thirtyDayStart} – ${dateStr}`);

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
        sevenDayAvgUsd: sevenDayAvg,
        deltaPct,
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
