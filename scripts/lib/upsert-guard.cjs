'use strict';
const rowKey = row => ['user_id', 'capture_method', 'session_id', 'model', 'date_utc'].map(key => row[key]).join('\u0000');
const tokenTotal = row => ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens']
  .reduce((sum, key) => sum + Number(row[key] || 0), 0);
function filterMinDate(rows, minDate) {
  if (!minDate) return rows;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(minDate) || !Number.isFinite(Date.parse(minDate)) ||
      new Date(minDate).toISOString().slice(0, 10) !== minDate) throw new Error('TOKENMAXX_MIN_DATE must be YYYY-MM-DD');
  return rows.filter(row => row.date_utc >= minDate);
}
function shouldSkipShrink(row, stored, allowShrink = false) {
  return !allowShrink && !!stored && tokenTotal(row) * 1000 < tokenTotal(stored) * 995;
}
async function fetchExistingRows(rows, request) {
  if (!rows.length) return [];
  const earliest = rows.reduce((date, row) => row.date_utc < date ? row.date_utc : date, rows[0].date_utc);
  const users = new Map();
  for (const row of rows) {
    if (!users.has(row.user_id)) users.set(row.user_id, new Set());
    users.get(row.user_id).add(row.capture_method);
  }
  const result = [];
  for (const [user, methods] of users) {
    const query = new URLSearchParams({
      select: 'user_id,capture_method,session_id,model,date_utc,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens',
      user_id: `eq.${user}`, capture_method: `in.(${[...methods].map(m => JSON.stringify(m)).join(',')})`,
      date_utc: `gte.${earliest}`, order: 'user_id,capture_method,session_id,model,date_utc', limit: '1000',
    });
    for (let offset = 0; ; offset += 1000) {
      query.set('offset', String(offset));
      const page = await request(`usage_events?${query}`);
      if (!Array.isArray(page)) throw new Error('Invalid existing usage response');
      result.push(...page);
      if (page.length < 1000) break;
    }
  }
  return result;
}
async function guardUpsertRows(rows, request, { allowShrink = false, verbose = false, log = console.log } = {}) {
  if (allowShrink || !rows.length) return rows;
  const existing = new Map((await fetchExistingRows(rows, request)).map(row => [rowKey(row), row]));
  const accepted = rows.filter(row => {
    const skip = shouldSkipShrink(row, existing.get(rowKey(row)));
    if (skip && verbose) log(`    Shrink skipped: ${rowKey(row).replace(/\u0000/g, ' / ')}`);
    return !skip;
  });
  log(`    Never-shrink guard skipped ${rows.length - accepted.length} rows`);
  return accepted;
}
module.exports = { rowKey, tokenTotal, filterMinDate, shouldSkipShrink, fetchExistingRows, guardUpsertRows };
