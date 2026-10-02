-- Capture 1-hour cache writes and seed current Claude list pricing.
-- Forward-only: cost_locked rows are never touched; unlocked rows reprice
-- only when next written. This migration does not recompute history.

alter table public.usage_events
  add column if not exists cache_creation_1h_tokens bigint not null default 0;

do $migration$
begin
  if not exists (select 1 from pg_constraint
    where conname = 'usage_events_cache_1h_within_total'
      and conrelid = 'public.usage_events'::regclass) then
    alter table public.usage_events add constraint usage_events_cache_1h_within_total
      check (cache_creation_1h_tokens >= 0 and cache_creation_1h_tokens <= cache_creation_tokens) not valid;
  end if;
end;
$migration$;
alter table public.usage_events validate constraint usage_events_cache_1h_within_total;

create or replace function public.fn_compute_event_cost(
  p_input bigint, p_output bigint, p_cache_creation bigint,
  p_cache_creation_1h bigint, p_cache_read bigint,
  p_input_per_m numeric, p_output_per_m numeric,
  p_cache_write_per_m numeric, p_cache_read_per_m numeric
) returns numeric
language sql
immutable
as $function$
  select public.fn_compute_event_cost(
    p_input, p_output,
    greatest(coalesce(p_cache_creation, 0) - coalesce(p_cache_creation_1h, 0), 0),
    p_cache_read, p_input_per_m, p_output_per_m, p_cache_write_per_m, p_cache_read_per_m
  ) + coalesce(p_cache_creation_1h, 0) * coalesce(p_input_per_m, 0) * 2 / 1000000.0
$function$;

create or replace function public.fn_apply_snapshot_pricing()
returns trigger
language plpgsql
as $function$
declare
  pr v_active_pricing;
begin
  if coalesce(new.cost_locked, false) then
    return new;
  end if;

  select *
    into pr
    from fn_pricing_for(new.provider, new.model, coalesce(new.captured_at, now()));

  if pr.pricing_snapshot_id is not null then
    new.cost_usd := fn_compute_event_cost(
      new.input_tokens, new.output_tokens,
      new.cache_creation_tokens, new.cache_creation_1h_tokens, new.cache_read_tokens,
      pr.input_per_m_usd, pr.output_per_m_usd,
      pr.cache_write_per_m_usd, pr.cache_read_per_m_usd
    );
    new.pricing_snapshot_id := pr.pricing_snapshot_id;
  end if;

  return new;
end;
$function$;

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
             e.cache_creation_tokens, e.cache_creation_1h_tokens, e.cache_read_tokens,
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

insert into public.pricing_snapshots
  (provider, model, effective_date, effective_start_at, effective_end_at,
   input_per_m_usd, output_per_m_usd, cache_write_per_m_usd, cache_read_per_m_usd, source, notes)
select 'anthropic', seed.model, date '2025-01-01', timestamptz '2025-01-01 00:00:00+00', null,
  seed.input, seed.output, seed.cache_write, seed.cache_read,
  'claude-api-skill-2026-09-25',
  'list price; cache_write = 5-minute rate (1.25x input); 1-hour writes priced at 2x input by fn_compute_event_cost'
from (values
  ('claude-opus-5-5', 4, 20, 5.0, 0.20),
  ('claude-opus-5', 5, 25, 6.25, 0.50),
  ('claude-sonnet-5-5', 2, 10, 2.5, 0.20),
  ('claude-sonnet-5', 2, 10, 2.5, 0.20),
  ('claude-fable-5-1', 10, 50, 12.5, 0.25)
) as seed(model, input, output, cache_write, cache_read)
where not exists (
  select 1 from public.pricing_snapshots p
  where p.provider = 'anthropic' and p.model = seed.model and p.effective_end_at is null
);

notify pgrst, 'reload schema';

/* ROLLBACK (manual only; restores 0021/0022 function bodies)
create or replace function public.fn_apply_snapshot_pricing()
returns trigger
language plpgsql
as $function$
declare
  pr v_active_pricing;
begin
  select *
    into pr
    from fn_pricing_for(new.provider, new.model, coalesce(new.captured_at, now()));

  if pr.pricing_snapshot_id is not null then
    new.cost_usd := fn_compute_event_cost(
      new.input_tokens, new.output_tokens,
      new.cache_creation_tokens, new.cache_read_tokens,
      pr.input_per_m_usd, pr.output_per_m_usd,
      pr.cache_write_per_m_usd, pr.cache_read_per_m_usd
    );
    new.pricing_snapshot_id := pr.pricing_snapshot_id;
  end if;

  return new;
end;
$function$;

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

drop function if exists public.fn_compute_event_cost(bigint, bigint, bigint, bigint, bigint, numeric, numeric, numeric, numeric);
alter table public.usage_events drop constraint if exists usage_events_cache_1h_within_total;
alter table public.usage_events drop column if exists cache_creation_1h_tokens;
delete from public.pricing_snapshots where source = 'claude-api-skill-2026-09-25'
  and provider = 'anthropic'
  and model in ('claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-fable-5-1');
notify pgrst, 'reload schema';
*/
