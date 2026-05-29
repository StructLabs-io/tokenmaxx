-- Migration 0015: Seed Ben's subscriptions, subscription_members, quota_windows
-- Run after workspaces + users are seeded (0004+)
-- Uses subqueries to remain workspace-agnostic.

DO $$
DECLARE
  v_workspace_id  uuid;
  v_ben_user_id   uuid;
  v_claude_sub_id uuid;
  v_codex_sub_id  uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM workspaces LIMIT 1;
  SELECT id INTO v_ben_user_id  FROM users WHERE slug = 'ben-macbook';

  -- Claude Max 5x
  INSERT INTO subscriptions (workspace_id, provider, plan_name, monthly_cost_usd, billing_cycle_anchor, active, notes)
  VALUES (
    v_workspace_id,
    'anthropic',
    'Claude Max 5x',
    100.00,
    '2026-05-01',
    true,
    'Ben personal subscription. 5h rolling + weekly quota windows.'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_claude_sub_id;

  -- Codex Pro
  INSERT INTO subscriptions (workspace_id, provider, plan_name, monthly_cost_usd, billing_cycle_anchor, active, notes)
  VALUES (
    v_workspace_id,
    'openai-codex',
    'Codex Pro',
    20.00,
    '2026-05-01',
    true,
    'Ben Codex Pro subscription. 5h rolling + weekly quota windows.'
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_codex_sub_id;

  IF v_claude_sub_id IS NOT NULL THEN
    INSERT INTO subscription_members (subscription_id, user_id)
    VALUES (v_claude_sub_id, v_ben_user_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO quota_windows (subscription_id, window_label, window_type, window_hours, active)
    VALUES
      (v_claude_sub_id, 'Claude Max — 5h rolling', 'rolling_hours', 5,    true),
      (v_claude_sub_id, 'Claude Max — weekly',     'calendar_week', null, true);
  END IF;

  IF v_codex_sub_id IS NOT NULL THEN
    INSERT INTO subscription_members (subscription_id, user_id)
    VALUES (v_codex_sub_id, v_ben_user_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO quota_windows (subscription_id, window_label, window_type, window_hours, active)
    VALUES
      (v_codex_sub_id, 'Codex Pro — 5h rolling', 'rolling_hours', 5,    true),
      (v_codex_sub_id, 'Codex Pro — weekly',     'calendar_week', null, true);
  END IF;
END $$;
