/**
 * evaluate-quota-rules -- evaluate alert rules against a quota observation
 *
 * Accepts a POST with the most recent quota observation, checks all active
 * rules that match, and fires Telegram alerts for rules that crossed their
 * threshold (subject to per-rule cooldown).
 *
 * Call this after each quota_observations INSERT (from Tier 1/2 scripts or
 * manually). See CRON_SETUP.md §Quota Rule Evaluation for invocation pattern.
 *
 * Request body:
 *   { "quota_window_id": number, "percent_used": number }
 *
 * Required Supabase secrets:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key
 *   TELEGRAM_BOT_TOKEN        - Telegram bot token
 *   TELEGRAM_CHAT_ID          - Telegram chat/channel ID
 *   TELEGRAM_TOPIC_ID         - (optional) Message thread ID for topic groups
 *
 * Response:
 *   { "fired": number, "skipped": number, "errors": string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const TELEGRAM_TOPIC_ID = Deno.env.get('TELEGRAM_TOPIC_ID') ?? '';

interface RequestBody {
  quota_window_id: number;
  percent_used: number;
}

interface QuotaRule {
  id: number;
  workspace_id: string;
  target_user_id: string | null;
  target_subscription_id: string | null;
  window_type: string;
  threshold_pct: number;
  min_remaining_days: number | null;
  channel: string;
  channel_target: string;
  active: boolean;
  cooldown_hours: number;
  last_fired_at: string | null;
  notes: string | null;
}

interface QuotaWindow {
  id: number;
  window_label: string;
  window_type: string;
  window_hours: number | null;
}

Deno.serve(async (req: Request) => {
  try {
    // Validate env vars
    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
    if (!TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
    if (missing.length > 0) {
      const msg = `Missing required env vars: ${missing.join(', ')}`;
      console.error(msg);
      return jsonResponse({ error: msg }, 500);
    }

    // Parse + validate request body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
    }

    const { quota_window_id, percent_used } = body;

    if (typeof quota_window_id !== 'number' || typeof percent_used !== 'number') {
      return jsonResponse(
        { error: 'Body must include quota_window_id (number) and percent_used (number)' },
        400
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the quota window to get window_type + label
    const { data: windowRows, error: windowErr } = await supabase
      .from('quota_windows')
      .select('id, window_label, window_type, window_hours')
      .eq('id', quota_window_id)
      .limit(1);

    if (windowErr) throw new Error(`quota_windows lookup failed: ${windowErr.message}`);
    if (!windowRows || windowRows.length === 0) {
      return jsonResponse({ error: `quota_window id=${quota_window_id} not found` }, 404);
    }

    const window = windowRows[0] as QuotaWindow;
    console.log(
      `evaluate-quota-rules: window="${window.window_label}" (${window.window_type}), ` +
      `percent_used=${percent_used}`
    );

    // Fetch active rules that match this window_type and threshold
    const { data: rules, error: rulesErr } = await supabase
      .from('quota_rules')
      .select('*')
      .eq('active', true)
      .eq('window_type', window.window_type)
      .lte('threshold_pct', percent_used);

    if (rulesErr) throw new Error(`quota_rules query failed: ${rulesErr.message}`);
    if (!rules || rules.length === 0) {
      console.log('evaluate-quota-rules: no matching rules');
      return jsonResponse({ fired: 0, skipped: 0, errors: [] });
    }

    console.log(`evaluate-quota-rules: ${rules.length} rules match threshold`);

    const now = new Date();
    let fired = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const rule of rules as QuotaRule[]) {
      // Cooldown check
      if (rule.last_fired_at) {
        const lastFiredMs = new Date(rule.last_fired_at).getTime();
        const hoursSinceLastFire = (now.getTime() - lastFiredMs) / 3600000;
        if (hoursSinceLastFire < rule.cooldown_hours) {
          console.log(
            `rule ${rule.id}: in cooldown (${hoursSinceLastFire.toFixed(1)}h < ${rule.cooldown_hours}h) — skip`
          );
          skipped++;
          continue;
        }
      }

      // Fire the alert
      if (rule.channel === 'telegram') {
        try {
          await fireTelegramAlert(rule, window, percent_used);

          // Update last_fired_at
          const { error: updateErr } = await supabase
            .from('quota_rules')
            .update({ last_fired_at: now.toISOString() })
            .eq('id', rule.id);

          if (updateErr) {
            console.error(`rule ${rule.id}: failed to update last_fired_at: ${updateErr.message}`);
            errors.push(`rule ${rule.id}: last_fired_at update failed: ${updateErr.message}`);
          }

          console.log(`rule ${rule.id}: fired (telegram)`);
          fired++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`rule ${rule.id}: telegram send failed: ${msg}`);
          errors.push(`rule ${rule.id}: ${msg}`);
        }
      } else {
        console.warn(`rule ${rule.id}: unknown channel "${rule.channel}" — skipping`);
        skipped++;
      }
    }

    console.log(`evaluate-quota-rules: fired=${fired}, skipped=${skipped}, errors=${errors.length}`);

    return jsonResponse({ fired, skipped, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('evaluate-quota-rules error:', msg);
    return jsonResponse({ error: msg }, 500);
  }
});

// --- Telegram alert ---

async function fireTelegramAlert(
  rule: QuotaRule,
  window: QuotaWindow,
  percentUsed: number
): Promise<void> {
  // Use rule's channel_target as override chat_id if set and looks like an ID
  // Otherwise fall back to TELEGRAM_CHAT_ID
  const chatId = rule.channel_target && /^-?\d+$/.test(rule.channel_target)
    ? rule.channel_target
    : TELEGRAM_CHAT_ID;

  const windowLabel = window.window_label;
  const thresholdPct = rule.threshold_pct;
  const remaining = Math.round((100 - percentUsed) * 10) / 10;

  const text =
    `⚠️ <b>Quota alert</b>\n` +
    `\n` +
    `<b>${windowLabel}</b> is at <b>${percentUsed}%</b> used\n` +
    `Remaining: <b>${remaining}%</b>\n` +
    `Threshold: ${thresholdPct}%` +
    (rule.notes ? `\n\n<i>${rule.notes}</i>` : '');

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const bodyPayload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };

  // Use TELEGRAM_TOPIC_ID from env (per-rule topic support can be added later)
  if (TELEGRAM_TOPIC_ID) {
    bodyPayload.message_thread_id = parseInt(TELEGRAM_TOPIC_ID, 10);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${detail}`);
  }

  const result = await res.json() as { ok: boolean; description?: string };
  if (!result.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(result)}`);
  }
}

// --- JSON response helper ---

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
