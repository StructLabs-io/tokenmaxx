-- 0016_quota_rules.sql
-- Alert rules for quota thresholds. Evaluated by evaluate-quota-rules Edge Function.

create table quota_rules (
  id              bigserial primary key,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  target_user_id  uuid references users(id),
  target_subscription_id uuid references subscriptions(id),
  window_type     text not null,
  threshold_pct   numeric(5,2) not null,
  min_remaining_days int,
  channel         text not null,
  channel_target  text not null,
  active          boolean not null default true,
  cooldown_hours  int not null default 6,
  last_fired_at   timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

-- RLS: admin-only write, workspace members can read
alter table quota_rules enable row level security;

create policy "quota_rules_select" on quota_rules
  for select
  using (workspace_id in (select auth_workspace_ids()));

create policy "quota_rules_admin_write" on quota_rules
  using (auth_role_in_workspace(workspace_id) = 'admin')
  with check (auth_role_in_workspace(workspace_id) = 'admin');

-- Index for rule evaluation lookups
create index quota_rules_workspace_active_idx on quota_rules (workspace_id, active, window_type);
