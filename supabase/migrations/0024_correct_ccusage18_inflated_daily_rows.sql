-- 0024_correct_ccusage18_inflated_daily_rows.sql
-- HISTORY CORRECTION -- DO NOT APPLY WITHOUT BEN'S SIGN-OFF.
--
-- Root cause: the MacBook cron capture (local-capture.js) resolved a stale
-- nvm-local ccusage v18.0.9, which does not deduplicate streamed JSONL usage
-- entries (each assistant message is re-appended to the transcript on every
-- stream update). Daily token counts were inflated 2x-46x; e.g. opus-4-8
-- 2026-06-29 stored $18,198.50 vs the correct $352.68.
--
-- Correction basis: ccusage v20.1.0 (dedupes on message.id + requestId)
-- recomputed on 2026-07-03 from the raw Claude Code JSONL transcripts still
-- on disk (coverage 2026-02-15 .. 2026-07-03). Rows are cost_locked, so the
-- pricing trigger will not touch them; this migration writes both the
-- corrected token counts and the ccusage-computed cost directly.
--
-- Scope: 132 rows, capture_method anthropic.ccusage.cli.ben_macbook,
-- aggregation_grain daily. Stored total $53,311.60 -> corrected
-- $13,343.36 (removes $39,968.24 of double-counted value).
--
-- NOT corrected: 97 older rows (2026-02-03 .. 2026-05-30, $3,014.25 stored)
-- whose source JSONL no longer exists; they cannot be recomputed and are
-- left untouched.

begin;

update usage_events set input_tokens = 4035, output_tokens = 69639, cache_creation_tokens = 753953, cache_read_tokens = 7563139, cost_usd = 6.152955
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-06' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-06-claude-sonnet-4-6';

update usage_events set input_tokens = 2180, output_tokens = 479994, cache_creation_tokens = 2455822, cache_read_tokens = 230846039, cost_usd = 85.669594
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-08' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-08-claude-sonnet-4-6';

update usage_events set input_tokens = 12, output_tokens = 4251, cache_creation_tokens = 270590, cache_read_tokens = 2130804, cost_usd = 1.717755
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-09' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-09-claude-sonnet-4-6';

update usage_events set input_tokens = 172, output_tokens = 88508, cache_creation_tokens = 718536, cache_read_tokens = 8360859, cost_usd = 10.884840
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-12' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-12-claude-opus-4-7';

update usage_events set input_tokens = 179, output_tokens = 140894, cache_creation_tokens = 342077, cache_read_tokens = 20300234, cost_usd = 9.486806
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-12' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-12-claude-sonnet-4-6';

update usage_events set input_tokens = 123, output_tokens = 41309, cache_creation_tokens = 302261, cache_read_tokens = 6784812, cost_usd = 6.314877
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-13' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-13-claude-opus-4-7';

update usage_events set input_tokens = 422, output_tokens = 102250, cache_creation_tokens = 911922, cache_read_tokens = 36391798, cost_usd = 15.872263
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-13' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-13-claude-sonnet-4-6';

update usage_events set input_tokens = 9285, output_tokens = 315206, cache_creation_tokens = 1808678, cache_read_tokens = 53926381, cost_usd = 46.194003
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-14' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-14-claude-opus-4-7';

update usage_events set input_tokens = 869, output_tokens = 44070, cache_creation_tokens = 205152, cache_read_tokens = 10313245, cost_usd = 4.526950
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-14' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-14-claude-sonnet-4-6';

update usage_events set input_tokens = 1303, output_tokens = 54246, cache_creation_tokens = 133475, cache_read_tokens = 21529150, cost_usd = 12.961459
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-16' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-16-claude-opus-4-7';

update usage_events set input_tokens = 80, output_tokens = 28557, cache_creation_tokens = 336713, cache_read_tokens = 5928555, cost_usd = 5.783059
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-25' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-25-claude-opus-4-7';

update usage_events set input_tokens = 80, output_tokens = 28557, cache_creation_tokens = 336713, cache_read_tokens = 5928555, cost_usd = 5.783059
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-25' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-25-claude-opus-4-7';

update usage_events set input_tokens = 425, output_tokens = 97968, cache_creation_tokens = 832201, cache_read_tokens = 24228747, cost_usd = 11.860173
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-25' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-25-claude-sonnet-4-6';

update usage_events set input_tokens = 425, output_tokens = 97968, cache_creation_tokens = 832201, cache_read_tokens = 24228747, cost_usd = 11.860173
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-25' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-25-claude-sonnet-4-6';

update usage_events set input_tokens = 20195, output_tokens = 520296, cache_creation_tokens = 2456167, cache_read_tokens = 140193426, cost_usd = 98.556132
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-28' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-28-claude-opus-4-7';

update usage_events set input_tokens = 44081, output_tokens = 142317, cache_creation_tokens = 848153, cache_read_tokens = 24860294, cost_usd = 12.905660
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-28' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-28-claude-sonnet-4-6';

update usage_events set input_tokens = 1703, output_tokens = 476727, cache_creation_tokens = 4286514, cache_read_tokens = 402605575, cost_usd = 240.020190
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-29' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-29-claude-opus-4-7';

update usage_events set input_tokens = 563632, output_tokens = 1391408, cache_creation_tokens = 9498634, cache_read_tokens = 171669597, cost_usd = 109.682773
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-29' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-29-claude-sonnet-4-6';

update usage_events set input_tokens = 1214, output_tokens = 466997, cache_creation_tokens = 4048010, cache_read_tokens = 193977538, cost_usd = 133.969827
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-30' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-30-claude-opus-4-7';

update usage_events set input_tokens = 16669, output_tokens = 131606, cache_creation_tokens = 1143788, cache_read_tokens = 34846664, cost_usd = 16.767301
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-30' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-30-claude-sonnet-4-6';

update usage_events set input_tokens = 1642, output_tokens = 168748, cache_creation_tokens = 731761, cache_read_tokens = 27687529, cost_usd = 22.644181
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-31' and model = 'claude-opus-4-7' and session_id = 'daily-2026-05-31-claude-opus-4-7';

update usage_events set input_tokens = 7542, output_tokens = 164594, cache_creation_tokens = 942329, cache_read_tokens = 28574170, cost_usd = 14.597521
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-05-31' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-05-31-claude-sonnet-4-6';

update usage_events set input_tokens = 1218, output_tokens = 221373, cache_creation_tokens = 1020926, cache_read_tokens = 141350170, cost_usd = 82.596288
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-01' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-01-claude-opus-4-7';

update usage_events set input_tokens = 19120, output_tokens = 126430, cache_creation_tokens = 924095, cache_read_tokens = 11201180, cost_usd = 14.632534
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-01' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-01-claude-opus-4-8';

update usage_events set input_tokens = 81, output_tokens = 22050, cache_creation_tokens = 368035, cache_read_tokens = 2177007, cost_usd = 2.364226
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-01' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-01-claude-sonnet-4-6';

update usage_events set input_tokens = 922, output_tokens = 13256, cache_creation_tokens = 223904, cache_read_tokens = 3875631, cost_usd = 0.734645
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-02' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-02-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 2007, output_tokens = 493846, cache_creation_tokens = 4412202, cache_read_tokens = 354605538, cost_usd = 217.235216
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-02' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-02-claude-opus-4-7';

update usage_events set input_tokens = 64365, output_tokens = 426541, cache_creation_tokens = 2237860, cache_read_tokens = 78329657, cost_usd = 64.136803
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-02' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-02-claude-opus-4-8';

update usage_events set input_tokens = 2584, output_tokens = 110735, cache_creation_tokens = 950183, cache_read_tokens = 23455571, cost_usd = 12.268635
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-02' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-02-claude-sonnet-4-6';

update usage_events set input_tokens = 7211, output_tokens = 1090163, cache_creation_tokens = 6501100, cache_read_tokens = 415255586, cost_usd = 275.549798
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-03' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-03-claude-opus-4-7';

update usage_events set input_tokens = 4929, output_tokens = 29325, cache_creation_tokens = 899116, cache_read_tokens = 2639106, cost_usd = 7.696798
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-03' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-03-claude-opus-4-8';

update usage_events set input_tokens = 24251, output_tokens = 385963, cache_creation_tokens = 4368306, cache_read_tokens = 132972891, cost_usd = 62.135213
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-03' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-03-claude-sonnet-4-6';

update usage_events set input_tokens = 39329, output_tokens = 2353255, cache_creation_tokens = 22653928, cache_read_tokens = 674984564, cost_usd = 538.107352
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-04' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-04-claude-opus-4-7';

update usage_events set input_tokens = 16086, output_tokens = 218990, cache_creation_tokens = 1815488, cache_read_tokens = 106754361, cost_usd = 70.279161
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-04' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-04-claude-opus-4-8';

update usage_events set input_tokens = 17802, output_tokens = 513504, cache_creation_tokens = 3974801, cache_read_tokens = 136207703, cost_usd = 63.523781
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-04' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-04-claude-sonnet-4-6';

update usage_events set input_tokens = 187, output_tokens = 56415, cache_creation_tokens = 460920, cache_read_tokens = 33607812, cost_usd = 21.095966
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-05' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-05-claude-opus-4-7';

update usage_events set input_tokens = 9180, output_tokens = 328512, cache_creation_tokens = 2661776, cache_read_tokens = 135793388, cost_usd = 55.674896
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-05' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-05-claude-sonnet-4-6';

update usage_events set input_tokens = 890, output_tokens = 215393, cache_creation_tokens = 1025367, cache_read_tokens = 71215226, cost_usd = 47.405432
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-06' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-06-claude-opus-4-7';

update usage_events set input_tokens = 219, output_tokens = 39619, cache_creation_tokens = 595453, cache_read_tokens = 13523759, cost_usd = 6.885018
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-06' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-06-claude-sonnet-4-6';

update usage_events set input_tokens = 330, output_tokens = 145163, cache_creation_tokens = 633432, cache_read_tokens = 26478473, cost_usd = 20.828912
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-07' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-07-claude-opus-4-7';

update usage_events set input_tokens = 732, output_tokens = 93548, cache_creation_tokens = 258399, cache_read_tokens = 35278841, cost_usd = 12.958065
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-07' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-07-claude-sonnet-4-6';

update usage_events set input_tokens = 12837, output_tokens = 64346, cache_creation_tokens = 860234, cache_read_tokens = 6267818, cost_usd = 2.036641
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-08' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-08-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 1293, output_tokens = 525784, cache_creation_tokens = 4831337, cache_read_tokens = 295525245, cost_usd = 191.109544
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-08' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-08-claude-opus-4-7';

update usage_events set input_tokens = 8197, output_tokens = 414638, cache_creation_tokens = 2630668, cache_read_tokens = 80256119, cost_usd = 40.186002
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-08' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-08-claude-sonnet-4-6';

update usage_events set input_tokens = 56, output_tokens = 3544, cache_creation_tokens = 62985, cache_read_tokens = 406001, cost_usd = 0.137107
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-09' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-09-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 67, output_tokens = 18552, cache_creation_tokens = 1709180, cache_read_tokens = 19535077, cost_usd = 20.914048
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-09' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-09-claude-opus-4-7';

update usage_events set input_tokens = 12366, output_tokens = 180464, cache_creation_tokens = 896844, cache_read_tokens = 38304431, cost_usd = 29.330921
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-09' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-09-claude-opus-4-8';

update usage_events set input_tokens = 1025, output_tokens = 376471, cache_creation_tokens = 2339547, cache_read_tokens = 56195503, cost_usd = 31.282092
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-09' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-09-claude-sonnet-4-6';

update usage_events set input_tokens = 24112, output_tokens = 14054, cache_creation_tokens = 183693, cache_read_tokens = 2055572, cost_usd = 0.529555
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-10' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-10-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 4815, output_tokens = 622403, cache_creation_tokens = 5935898, cache_read_tokens = 291480040, cost_usd = 198.423533
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-10' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-10-claude-opus-4-7';

update usage_events set input_tokens = 13945, output_tokens = 7810, cache_creation_tokens = 116980, cache_read_tokens = 622594, cost_usd = 1.307397
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-10' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-10-claude-opus-4-8';

update usage_events set input_tokens = 42990, output_tokens = 278620, cache_creation_tokens = 3123675, cache_read_tokens = 73583508, cost_usd = 38.097104
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-10' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-10-claude-sonnet-4-6';

update usage_events set input_tokens = 612129, output_tokens = 1332325, cache_creation_tokens = 8252093, cache_read_tokens = 133527769, cost_usd = 309.416472
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-11' and model = 'claude-fable-5' and session_id = 'daily-2026-06-11-claude-fable-5';

update usage_events set input_tokens = 4798, output_tokens = 129961, cache_creation_tokens = 889814, cache_read_tokens = 36183274, cost_usd = 5.385198
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-11' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-11-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 998, output_tokens = 485369, cache_creation_tokens = 2003564, cache_read_tokens = 84314531, cost_usd = 66.818756
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-11' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-11-claude-opus-4-7';

update usage_events set input_tokens = 51377, output_tokens = 64925, cache_creation_tokens = 679540, cache_read_tokens = 2774289, cost_usd = 7.514279
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-11' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-11-claude-opus-4-8';

update usage_events set input_tokens = 25209, output_tokens = 882702, cache_creation_tokens = 6235747, cache_read_tokens = 185945436, cost_usd = 92.483839
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-11' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-11-claude-sonnet-4-6';

update usage_events set input_tokens = 917539, output_tokens = 1663785, cache_creation_tokens = 11142316, cache_read_tokens = 189203143, cost_usd = 420.846733
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-12' and model = 'claude-fable-5' and session_id = 'daily-2026-06-12-claude-fable-5';

update usage_events set input_tokens = 787, output_tokens = 34129, cache_creation_tokens = 2671279, cache_read_tokens = 9537422, cost_usd = 4.464273
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-12' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-12-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 246, output_tokens = 56584, cache_creation_tokens = 441833, cache_read_tokens = 9836493, cost_usd = 9.095533
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-12' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-12-claude-opus-4-7';

update usage_events set input_tokens = 305043, output_tokens = 805258, cache_creation_tokens = 9029613, cache_read_tokens = 103460676, cost_usd = 129.822084
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-12' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-12-claude-opus-4-8';

update usage_events set input_tokens = 199, output_tokens = 93767, cache_creation_tokens = 691538, cache_read_tokens = 11840376, cost_usd = 7.552482
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-12' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-12-claude-sonnet-4-6';

update usage_events set input_tokens = 190827, output_tokens = 874586, cache_creation_tokens = 3591731, cache_read_tokens = 123791715, cost_usd = 214.325923
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-13' and model = 'claude-fable-5' and session_id = 'daily-2026-06-13-claude-fable-5';

update usage_events set input_tokens = 1731, output_tokens = 6091, cache_creation_tokens = 192371, cache_read_tokens = 2337480, cost_usd = 0.506398
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-13' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-13-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 742762, output_tokens = 1877970, cache_creation_tokens = 13469781, cache_read_tokens = 335003218, cost_usd = 302.350800
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-13' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-13-claude-opus-4-8';

update usage_events set input_tokens = 6603, output_tokens = 408692, cache_creation_tokens = 4147179, cache_read_tokens = 99851183, cost_usd = 51.657465
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-13' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-13-claude-sonnet-4-6';

update usage_events set input_tokens = 3975, output_tokens = 31130, cache_creation_tokens = 1211903, cache_read_tokens = 7203645, cost_usd = 2.394868
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-14' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-14-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 84627, output_tokens = 260934, cache_creation_tokens = 2569962, cache_read_tokens = 40419857, cost_usd = 43.218676
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-14' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-14-claude-opus-4-8';

update usage_events set input_tokens = 22324, output_tokens = 520986, cache_creation_tokens = 8603156, cache_read_tokens = 153225316, cost_usd = 86.111192
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-14' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-14-claude-sonnet-4-6';

update usage_events set input_tokens = 244, output_tokens = 10049, cache_creation_tokens = 280597, cache_read_tokens = 4707623, cost_usd = 0.871998
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-15' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-15-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 459, output_tokens = 175309, cache_creation_tokens = 2030825, cache_read_tokens = 52945480, cost_usd = 43.550416
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-15' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-15-claude-opus-4-7';

update usage_events set input_tokens = 293450, output_tokens = 626225, cache_creation_tokens = 8992069, cache_read_tokens = 176100276, cost_usd = 161.373444
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-15' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-15-claude-opus-4-8';

update usage_events set input_tokens = 6553, output_tokens = 625651, cache_creation_tokens = 6088310, cache_read_tokens = 164230045, cost_usd = 81.504600
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-15' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-15-claude-sonnet-4-6';

update usage_events set input_tokens = 2552, output_tokens = 67088, cache_creation_tokens = 1652696, cache_read_tokens = 36843669, cost_usd = 6.088229
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-16' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-16-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 125, output_tokens = 59048, cache_creation_tokens = 1326800, cache_read_tokens = 21662663, cost_usd = 20.600656
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-16' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-16-claude-opus-4-7';

update usage_events set input_tokens = 308734, output_tokens = 591395, cache_creation_tokens = 3897624, cache_read_tokens = 56144412, cost_usd = 68.760901
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-16' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-16-claude-opus-4-8';

update usage_events set input_tokens = 8575, output_tokens = 435100, cache_creation_tokens = 5279355, cache_read_tokens = 112336739, cost_usd = 60.050828
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-16' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-16-claude-sonnet-4-6';

update usage_events set input_tokens = 993, output_tokens = 31135, cache_creation_tokens = 2219238, cache_read_tokens = 13797336, cost_usd = 4.310449
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-17' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-17-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 877, output_tokens = 315108, cache_creation_tokens = 6141579, cache_read_tokens = 64344480, cost_usd = 78.439194
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-17' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-17-claude-opus-4-7';

update usage_events set input_tokens = 1201592, output_tokens = 2012810, cache_creation_tokens = 16515031, cache_read_tokens = 435439636, cost_usd = 377.266972
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-17' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-17-claude-opus-4-8';

update usage_events set input_tokens = 9528, output_tokens = 619609, cache_creation_tokens = 5320758, cache_read_tokens = 237389627, cost_usd = 100.492450
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-17' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-17-claude-sonnet-4-6';

update usage_events set input_tokens = 675, output_tokens = 62289, cache_creation_tokens = 959448, cache_read_tokens = 11619298, cost_usd = 2.673360
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-18' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-18-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 1194, output_tokens = 325990, cache_creation_tokens = 2689898, cache_read_tokens = 94209135, cost_usd = 72.072150
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-18' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-18-claude-opus-4-7';

update usage_events set input_tokens = 911474, output_tokens = 1879843, cache_creation_tokens = 19254450, cache_read_tokens = 663687469, cost_usd = 503.737492
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-18' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-18-claude-opus-4-8';

update usage_events set input_tokens = 9602, output_tokens = 51078, cache_creation_tokens = 618621, cache_read_tokens = 26610872, cost_usd = 11.098066
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-18' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-18-claude-sonnet-4-6';

update usage_events set input_tokens = 247, output_tokens = 16612, cache_creation_tokens = 255835, cache_read_tokens = 2573420, cost_usd = 0.660443
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-19' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-19-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 3527, output_tokens = 210624, cache_creation_tokens = 1970063, cache_read_tokens = 64392093, cost_usd = 49.792175
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-19' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-19-claude-opus-4-7';

update usage_events set input_tokens = 569105, output_tokens = 1018922, cache_creation_tokens = 11048157, cache_read_tokens = 337255582, cost_usd = 265.997347
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-19' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-19-claude-opus-4-8';

update usage_events set input_tokens = 242, output_tokens = 24050, cache_creation_tokens = 386527, cache_read_tokens = 24152306, cost_usd = 9.056644
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-19' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-19-claude-sonnet-4-6';

update usage_events set input_tokens = 316, output_tokens = 77031, cache_creation_tokens = 2802031, cache_read_tokens = 18541737, cost_usd = 28.710917
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-20' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-20-claude-opus-4-7';

update usage_events set input_tokens = 47948, output_tokens = 81656, cache_creation_tokens = 966398, cache_read_tokens = 16222438, cost_usd = 16.432346
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-20' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-20-claude-opus-4-8';

update usage_events set input_tokens = 19388, output_tokens = 134572, cache_creation_tokens = 2879617, cache_read_tokens = 22840439, cost_usd = 32.879066
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-21' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-21-claude-opus-4-7';

update usage_events set input_tokens = 36126, output_tokens = 37130, cache_creation_tokens = 770275, cache_read_tokens = 4328984, cost_usd = 4.852554
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-21' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-21-claude-sonnet-4-6';

update usage_events set input_tokens = 191, output_tokens = 3618, cache_creation_tokens = 188594, cache_read_tokens = 2615753, cost_usd = 0.515599
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-22' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-22-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 20799, output_tokens = 876385, cache_creation_tokens = 18153743, cache_read_tokens = 236231370, cost_usd = 253.590199
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-22' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-22-claude-opus-4-7';

update usage_events set input_tokens = 262440, output_tokens = 331992, cache_creation_tokens = 3133941, cache_read_tokens = 54193132, cost_usd = 56.295697
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-22' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-22-claude-opus-4-8';

update usage_events set input_tokens = 176, output_tokens = 38485, cache_creation_tokens = 713202, cache_read_tokens = 7438223, cost_usd = 5.483777
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-22' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-22-claude-sonnet-4-6';

update usage_events set input_tokens = 81854, output_tokens = 1512015, cache_creation_tokens = 40313208, cache_read_tokens = 376540421, cost_usd = 478.437406
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-23' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-23-claude-opus-4-7';

update usage_events set input_tokens = 772242, output_tokens = 727880, cache_creation_tokens = 10588073, cache_read_tokens = 184842187, cost_usd = 180.654760
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-23' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-23-claude-opus-4-8';

update usage_events set input_tokens = 95, output_tokens = 30888, cache_creation_tokens = 177477, cache_read_tokens = 5383778, cost_usd = 2.744277
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-23' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-23-claude-sonnet-4-6';

update usage_events set input_tokens = 19212, output_tokens = 15357, cache_creation_tokens = 523403, cache_read_tokens = 1875727, cost_usd = 0.937823
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-24' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-24-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 19706, output_tokens = 1178102, cache_creation_tokens = 39706256, cache_read_tokens = 383819776, cost_usd = 469.625068
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-24' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-24-claude-opus-4-7';

update usage_events set input_tokens = 320931, output_tokens = 286096, cache_creation_tokens = 3979081, cache_read_tokens = 59888691, cost_usd = 63.570657
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-24' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-24-claude-opus-4-8';

update usage_events set input_tokens = 95, output_tokens = 24862, cache_creation_tokens = 357580, cache_read_tokens = 3897812, cost_usd = 2.883484
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-24' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-24-claude-sonnet-4-6';

update usage_events set input_tokens = 57, output_tokens = 1685, cache_creation_tokens = 54352, cache_read_tokens = 540220, cost_usd = 0.130444
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-25' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-25-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 54524, output_tokens = 2843039, cache_creation_tokens = 53983588, cache_read_tokens = 689470076, cost_usd = 753.481058
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-25' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-25-claude-opus-4-7';

update usage_events set input_tokens = 307802, output_tokens = 651528, cache_creation_tokens = 5015408, cache_read_tokens = 167120865, cost_usd = 132.733943
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-25' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-25-claude-opus-4-8';

update usage_events set input_tokens = 22073, output_tokens = 718524, cache_creation_tokens = 7463785, cache_read_tokens = 159973003, cost_usd = 86.825174
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-25' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-25-claude-sonnet-4-6';

update usage_events set input_tokens = 6392, output_tokens = 728874, cache_creation_tokens = 17151269, cache_read_tokens = 166960939, cost_usd = 208.929711
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-26' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-26-claude-opus-4-7';

update usage_events set input_tokens = 78343, output_tokens = 88690, cache_creation_tokens = 1930211, cache_read_tokens = 22558762, cost_usd = 25.952165
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-26' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-26-claude-opus-4-8';

update usage_events set input_tokens = 94491, output_tokens = 5097621, cache_creation_tokens = 62639573, cache_read_tokens = 1146452965, cost_usd = 655.582076
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-26' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-26-claude-sonnet-4-6';

update usage_events set input_tokens = 19160, output_tokens = 9913, cache_creation_tokens = 381534, cache_read_tokens = 1804651, cost_usd = 0.726108
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-27' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-06-27-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 3062, output_tokens = 878169, cache_creation_tokens = 8437886, cache_read_tokens = 395462143, cost_usd = 272.437394
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-27' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-27-claude-opus-4-7';

update usage_events set input_tokens = 7600, output_tokens = 15043, cache_creation_tokens = 588018, cache_read_tokens = 4604018, cost_usd = 6.391197
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-27' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-27-claude-opus-4-8';

update usage_events set input_tokens = 68389, output_tokens = 5362848, cache_creation_tokens = 58225137, cache_read_tokens = 938880586, cost_usd = 580.656327
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-27' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-27-claude-sonnet-4-6';

update usage_events set input_tokens = 670, output_tokens = 169434, cache_creation_tokens = 598619, cache_read_tokens = 79757930, cost_usd = 47.859534
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-28' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-28-claude-opus-4-7';

update usage_events set input_tokens = 31043, output_tokens = 22651, cache_creation_tokens = 935187, cache_read_tokens = 5830069, cost_usd = 9.481443
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-28' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-28-claude-opus-4-8';

update usage_events set input_tokens = 15620, output_tokens = 711346, cache_creation_tokens = 9498182, cache_read_tokens = 131071275, cost_usd = 85.656615
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-28' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-28-claude-sonnet-4-6';

update usage_events set input_tokens = 549065, output_tokens = 1420728, cache_creation_tokens = 30497372, cache_read_tokens = 247625023, cost_usd = 352.684612
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-29' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-29-claude-opus-4-8';

update usage_events set input_tokens = 91, output_tokens = 96149, cache_creation_tokens = 1103084, cache_read_tokens = 5709056, cost_usd = 7.291790
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-29' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-06-29-claude-sonnet-4-6';

update usage_events set input_tokens = 19, output_tokens = 6180, cache_creation_tokens = 361923, cache_read_tokens = 866108, cost_usd = 2.849668
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-30' and model = 'claude-opus-4-7' and session_id = 'daily-2026-06-30-claude-opus-4-7';

update usage_events set input_tokens = 464158, output_tokens = 1618497, cache_creation_tokens = 19273064, cache_read_tokens = 270570141, cost_usd = 298.524936
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-06-30' and model = 'claude-opus-4-8' and session_id = 'daily-2026-06-30-claude-opus-4-8';

update usage_events set input_tokens = 440, output_tokens = 41201, cache_creation_tokens = 622276, cache_read_tokens = 21674145, cost_usd = 15.758523
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-01' and model = 'claude-opus-4-7' and session_id = 'daily-2026-07-01-claude-opus-4-7';

update usage_events set input_tokens = 314146, output_tokens = 497128, cache_creation_tokens = 12007818, cache_read_tokens = 139137951, cost_usd = 158.616768
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-01' and model = 'claude-opus-4-8' and session_id = 'daily-2026-07-01-claude-opus-4-8';

update usage_events set input_tokens = 420, output_tokens = 179506, cache_creation_tokens = 2077114, cache_read_tokens = 38658913, cost_usd = 22.080701
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-01' and model = 'claude-sonnet-4-6' and session_id = 'daily-2026-07-01-claude-sonnet-4-6';

update usage_events set input_tokens = 271712, output_tokens = 467374, cache_creation_tokens = 10080945, cache_read_tokens = 112102447, cost_usd = 264.200080
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-02' and model = 'claude-fable-5' and session_id = 'daily-2026-07-02-claude-fable-5';

update usage_events set input_tokens = 272, output_tokens = 10818, cache_creation_tokens = 151476, cache_read_tokens = 1911616, cost_usd = 0.434869
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-02' and model = 'claude-haiku-4-5-20251001' and session_id = 'daily-2026-07-02-claude-haiku-4-5-20251001';

update usage_events set input_tokens = 570, output_tokens = 91654, cache_creation_tokens = 6274825, cache_read_tokens = 41470136, cost_usd = 62.246924
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-02' and model = 'claude-opus-4-7' and session_id = 'daily-2026-07-02-claude-opus-4-7';

update usage_events set input_tokens = 2513187, output_tokens = 4489511, cache_creation_tokens = 62708833, cache_read_tokens = 707893682, cost_usd = 870.680757
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-02' and model = 'claude-opus-4-8' and session_id = 'daily-2026-07-02-claude-opus-4-8';

update usage_events set input_tokens = 38813, output_tokens = 80073, cache_creation_tokens = 1743302, cache_read_tokens = 14811929, cost_usd = 40.994984
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-03' and model = 'claude-fable-5' and session_id = 'daily-2026-07-03-claude-fable-5';

update usage_events set input_tokens = 228, output_tokens = 25409, cache_creation_tokens = 3828002, cache_read_tokens = 28132369, cost_usd = 38.627562
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-03' and model = 'claude-opus-4-7' and session_id = 'daily-2026-07-03-claude-opus-4-7';

update usage_events set input_tokens = 167407, output_tokens = 311633, cache_creation_tokens = 4505758, cache_read_tokens = 42171147, cost_usd = 57.874421
  where capture_method = 'anthropic.ccusage.cli.ben_macbook' and aggregation_grain = 'daily' and date_utc = '2026-07-03' and model = 'claude-opus-4-8' and session_id = 'daily-2026-07-03-claude-opus-4-8';

commit;
