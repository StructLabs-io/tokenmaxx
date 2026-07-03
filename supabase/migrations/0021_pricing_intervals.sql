-- 0021_pricing_intervals.sql
-- Add exact pricing validity intervals to pricing_snapshots while keeping the
-- legacy effective_date column compatible, and provide the temporal cost path:
--   fn_compute_event_cost  -- pure token x price arithmetic (IMMUTABLE)
--   v_active_pricing       -- flattened snapshot rows with interval bounds
--   fn_pricing_for         -- pick the snapshot in effect at a given time/date
--   fn_recompute_costs     -- reprice unlocked events from the active snapshot
--
-- This file is self-contained and idempotent: every object uses
-- create-or-replace / if-not-exists / drop-if-exists so it can be re-applied
-- against a database where it has already run.

-- 1. Interval columns -------------------------------------------------------

alter table pricing_snapshots
  add column if not exists effective_start_at timestamptz,
  add column if not exists effective_end_at   timestamptz;

update pricing_snapshots
  set effective_start_at = effective_date::timestamptz
  where effective_start_at is null;

alter table pricing_snapshots
  alter column effective_start_at set not null;

-- 2. Keys / indexes ---------------------------------------------------------
-- Drop the old (provider, model, effective_date) unique key; intervals now
-- own uniqueness. Enforce one snapshot per start instant, and at most one
-- open-ended (currently active) snapshot per model.

alter table pricing_snapshots
  drop constraint if exists pricing_snapshots_provider_model_effective_date_key;

create unique index if not exists pricing_snapshots_provider_model_start_key
  on pricing_snapshots (provider, model, effective_start_at);

create index if not exists pricing_snapshots_provider_model_effective_date_idx
  on pricing_snapshots (provider, model, effective_date desc);

create unique index if not exists pricing_snapshots_one_active_per_model
  on pricing_snapshots (provider, model)
  where effective_end_at is null;

-- 3. Active-pricing view ----------------------------------------------------

create or replace view v_active_pricing as
  select
    id as pricing_snapshot_id,
    provider,
    model,
    effective_date,
    (effective_end_at - interval '1 microsecond')::date as effective_until,
    input_per_m_usd,
    output_per_m_usd,
    cache_write_per_m_usd,
    cache_read_per_m_usd,
    effective_start_at,
    effective_end_at
  from pricing_snapshots;

-- 4. Pure cost arithmetic ---------------------------------------------------
-- cache_creation falls back to the input rate, cache_read to 10% of input,
-- when a snapshot leaves the cache columns null.

create or replace function public.fn_compute_event_cost(
  p_input           bigint,
  p_output          bigint,
  p_cache_creation  bigint,
  p_cache_read      bigint,
  p_input_per_m     numeric,
  p_output_per_m    numeric,
  p_cache_write_per_m numeric,
  p_cache_read_per_m  numeric
) returns numeric
language sql
immutable
as $function$
  select coalesce(p_input,0)          * coalesce(p_input_per_m, 0)      / 1000000.0
       + coalesce(p_output,0)         * coalesce(p_output_per_m, 0)     / 1000000.0
       + coalesce(p_cache_creation,0) * coalesce(p_cache_write_per_m, p_input_per_m, 0) / 1000000.0
       + coalesce(p_cache_read,0)     * coalesce(p_cache_read_per_m, p_input_per_m * 0.1, 0) / 1000000.0
$function$;

-- 5. Snapshot lookup by instant / date -------------------------------------

create or replace function public.fn_pricing_for(
  p_provider text, p_model text, p_at timestamptz
) returns v_active_pricing
language sql
stable
as $function$
  select *
  from v_active_pricing
  where provider = p_provider
    and model = p_model
    and effective_start_at <= p_at
    and (effective_end_at is null or p_at < effective_end_at)
  order by effective_start_at desc
  limit 1
$function$;

create or replace function public.fn_pricing_for(
  p_provider text, p_model text, p_date date
) returns v_active_pricing
language sql
stable
as $function$
  select *
  from fn_pricing_for(p_provider, p_model, p_date::timestamptz)
$function$;

-- 6. Reprice unlocked events from the active snapshot ----------------------
-- Skips rows where cost_locked is true (frozen history) and rows with no
-- matching snapshot (cost left as captured).

create or replace function public.fn_recompute_costs(
  p_from date default null, p_to date default null
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  touched int := 0;
begin
  with picks as (
    select e.id,
           p.pricing_snapshot_id,
           fn_compute_event_cost(
             e.input_tokens, e.output_tokens,
             e.cache_creation_tokens, e.cache_read_tokens,
             p.input_per_m_usd, p.output_per_m_usd,
             p.cache_write_per_m_usd, p.cache_read_per_m_usd
           ) as new_cost
    from usage_events e
    left join lateral fn_pricing_for(e.provider, e.model, e.captured_at) p on true
    where coalesce(e.cost_locked, false) = false
      and (p_from is null or e.date_utc >= p_from)
      and (p_to   is null or e.date_utc <= p_to)
      and p.pricing_snapshot_id is not null
  )
  update usage_events e
  set cost_usd = picks.new_cost,
      pricing_snapshot_id = picks.pricing_snapshot_id
  from picks
  where e.id = picks.id
    and (e.cost_usd is distinct from picks.new_cost
         or e.pricing_snapshot_id is distinct from picks.pricing_snapshot_id);

  get diagnostics touched = row_count;
  return touched;
end;
$function$;
