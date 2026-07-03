-- 0022_seed_current_pricing.sql
-- Make pricing_snapshots the current, complete pricing reference and wire it
-- as the authoritative source for going-forward Anthropic event costs.
--
-- Context: until now event cost_usd came from ccusage's own bundled price feed
-- (baked into m.cost at capture time). pricing_snapshots existed but was never
-- read by the live cost path. This migration:
--   1. fills the cache columns on existing snapshots with current list prices
--   2. adds the two active Anthropic models missing a snapshot (opus-4-8, fable-5)
--   3. freezes all existing usage_events (cost_locked = true) so historical
--      as-captured costs are preserved exactly
--   4. installs a BEFORE INSERT/UPDATE trigger that prices new *unlocked
--      Anthropic* events from the active snapshot
--
-- Scope note (judgement call): the trigger is Anthropic-only. Snapshot pricing
-- reproduces ccusage's baked cost to the cent for the active Anthropic models
-- (opus-4-8, fable-5) because Anthropic cache-write is 1.25x input and
-- cache-read is 0.10x input. OpenAI / codex events (100k+ rows, cache math not
-- yet verified against ccusage) continue to use ccusage's baked cost. Widen the
-- trigger to those providers only after verifying their snapshot repro.

-- 1. Fill cache columns on existing snapshots -------------------------------
-- Anthropic list pricing: cache_write = 1.25x input, cache_read = 0.10x input
-- (holds for every Anthropic tier: opus 5 -> 6.25/0.50, sonnet 3 -> 3.75/0.30,
-- haiku 1 -> 1.25/0.10, fable 10 -> 12.50/1.00).

update pricing_snapshots
  set cache_write_per_m_usd = round(input_per_m_usd * 1.25, 4),
      cache_read_per_m_usd  = round(input_per_m_usd * 0.10, 4)
  where provider = 'anthropic'
    and (cache_write_per_m_usd is null or cache_read_per_m_usd is null);

-- OpenAI / codex reference values: cached input is discounted ~90% (0.10x),
-- and there is no separate cache-write surcharge (creation billed at input).
update pricing_snapshots
  set cache_write_per_m_usd = coalesce(cache_write_per_m_usd, input_per_m_usd),
      cache_read_per_m_usd  = coalesce(cache_read_per_m_usd, round(input_per_m_usd * 0.10, 4))
  where provider in ('openai', 'openai-codex')
    and (cache_write_per_m_usd is null or cache_read_per_m_usd is null);

-- 2. Add active Anthropic models missing a snapshot -------------------------
-- Model strings match usage_events exactly (dashed form).
-- opus-4-8: 5 / 25 in/out.  fable-5: 10 / 50 in/out.

insert into pricing_snapshots
  (provider, model, effective_date, input_per_m_usd, output_per_m_usd,
   cache_write_per_m_usd, cache_read_per_m_usd, source, notes,
   created_at, effective_start_at, effective_end_at)
values
  ('anthropic', 'claude-opus-4-8', date '2025-01-01', 5.0000, 25.0000,
   6.2500, 0.5000, 'manual-seed-2026-07', 'current list price', now(),
   timestamptz '2025-01-01 00:00:00+00', null),
  ('anthropic', 'claude-fable-5', date '2025-01-01', 10.0000, 50.0000,
   12.5000, 1.0000, 'manual-seed-2026-07', 'current list price', now(),
   timestamptz '2025-01-01 00:00:00+00', null)
on conflict (provider, model, effective_start_at) do update
  set input_per_m_usd       = excluded.input_per_m_usd,
      output_per_m_usd      = excluded.output_per_m_usd,
      cache_write_per_m_usd = excluded.cache_write_per_m_usd,
      cache_read_per_m_usd  = excluded.cache_read_per_m_usd,
      source                = excluded.source,
      notes                 = excluded.notes;

-- 3. Freeze existing history ------------------------------------------------
-- Every currently-stored event keeps its as-captured cost (the API-list-
-- equivalent value ccusage computed). Locking blocks fn_recompute_costs and
-- the pricing trigger from ever mutating these rows.

update usage_events
  set cost_locked = true
  where coalesce(cost_locked, false) = false;

-- 4. Going-forward pricing trigger (Anthropic, unlocked rows only) ----------

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

drop trigger if exists trg_apply_snapshot_pricing on usage_events;

create trigger trg_apply_snapshot_pricing
  before insert or update on usage_events
  for each row
  when (coalesce(new.cost_locked, false) = false and new.provider = 'anthropic')
  execute function public.fn_apply_snapshot_pricing();
