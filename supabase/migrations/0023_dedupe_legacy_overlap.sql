-- 0023_dedupe_legacy_overlap.sql
-- Remove double-counted legacy events.
--
-- The legacy capture pipelines (claude_code, codex; both stopped 2026-05-29)
-- and the current ccusage pipelines both ingested usage from the same machine
-- on overlapping days. capture_method is provider.pipeline.cli.context; the
-- context maps to a machine (personal_dev/ben_macbook = laptop,
-- openclaw/openclaw_server = server). A legacy row is a genuine duplicate when
-- a current ccusage row exists for the same (provider, model, date_utc,
-- machine) -- the same underlying tokens counted twice in the total.
--
-- Measured set at authoring time: 122 rows / $2,018.06
--   claude_code / laptop  111 rows  $1,868.84  (2026-04-25 .. 2026-05-29)
--   codex       / laptop   11 rows    $149.22  (2026-05-21 .. 2026-05-27)
--
-- This deletes only the redundant legacy rows; the current ccusage coverage
-- for those days is retained.

with e as (
  select id, provider, model, date_utc,
    split_part(capture_method, '.', 2) as pipeline,
    case split_part(capture_method, '.', 4)
      when 'personal_dev'    then 'laptop'
      when 'ben_macbook'     then 'laptop'
      when 'openclaw'        then 'server'
      when 'openclaw_server' then 'server'
      else split_part(capture_method, '.', 4)
    end as machine
  from usage_events
),
legacy as (
  select * from e where pipeline in ('claude_code', 'codex')
),
current_cov as (
  select distinct provider, model, date_utc, machine
  from e
  where pipeline in ('ccusage', 'ccusage_openclaw')
),
overlap as (
  select l.id
  from legacy l
  join current_cov c
    on c.provider = l.provider
   and c.model    = l.model
   and c.date_utc = l.date_utc
   and c.machine  = l.machine
)
delete from usage_events u
using overlap o
where u.id = o.id;
