'use strict';

function createSupabaseRestClient({ url, serviceRoleKey, fetchImpl = fetch }) {
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  return async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${response.status}): ${detail}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

async function upsertInBatches(request, table, rows, { conflict, batchSize = 100 } = {}) {
  for (let index = 0; index < rows.length; index += batchSize) {
    await request(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: 'POST',
      body: rows.slice(index, index + batchSize),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }
}

// Minimal GET helper used by capture-freshness.js; throws on non-2xx without echoing the body.
function createSupabaseRequest({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return async function request(resource) {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/${resource}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
    return response.json();
  };
}

module.exports = { createSupabaseRestClient, upsertInBatches, createSupabaseRequest };
