-- 0014_cron_schedules.sql
-- Tokenmaxx scheduled Edge Function invocations via pg_cron + pg_net
--
-- Prerequisites (run once in Supabase Dashboard > Database > Extensions):
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- Replace <SERVICE_ROLE_KEY> with the value of SUPABASE_TOKENMAXX_PROD_SERVICE_ROLE_KEY
-- before running. Ben runs this in Supabase Studio SQL editor.

-- Daily digest at 23:00 UTC (07:00 MYT next morning)
SELECT cron.schedule(
  'daily-digest',
  '0 23 * * *',
  $$SELECT net.http_post(
    url := 'https://ewaknihwrzysakbtjzlx.supabase.co/functions/v1/daily-digest',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$$
);

-- Pricing pull at 02:00 UTC daily
SELECT cron.schedule(
  'pricing-pull',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := 'https://ewaknihwrzysakbtjzlx.supabase.co/functions/v1/pricing-pull',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$$
);

-- FX rate at 01:00 UTC daily
SELECT cron.schedule(
  'fx-rate',
  '0 1 * * *',
  $$SELECT net.http_post(
    url := 'https://ewaknihwrzysakbtjzlx.supabase.co/functions/v1/fx-rate',
    headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )$$
);

-- To verify schedules are registered:
-- SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;

-- To unschedule (if needed):
-- SELECT cron.unschedule('daily-digest');
-- SELECT cron.unschedule('pricing-pull');
-- SELECT cron.unschedule('fx-rate');
